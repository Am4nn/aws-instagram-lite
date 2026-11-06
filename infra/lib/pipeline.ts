import { Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as events from "aws-cdk-lib/aws-events";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import type { CoreStack } from "./core-stack.js";

/**
 * Photo pipeline:
 *   browser --presigned PUT--> uploads bucket --ObjectCreated--> SQS (+DLQ) --> starter Lambda
 *   --> Step Functions: Validate → Resize → Save → Publish(EventBridge)   (any failure → MarkFailed)
 */
export function addPipeline(stack: CoreStack) {
  const { prefix } = stack.stageConfig;
  const account = stack.account;

  // ---------- Buckets ----------
  const uploadsName = `${prefix}-uploads-${account}`; // bucket names are global on AWS
  const dlq = new sqs.Queue(stack, "UploadsDlq", { queueName: `${prefix}-uploads-dlq`, retentionPeriod: Duration.days(14) });
  const queue = new sqs.Queue(stack, "UploadsQueue", {
    queueName: `${prefix}-uploads`,
    visibilityTimeout: Duration.seconds(60), // > starter timeout, so a slow run isn't delivered twice
    deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
  });
  queue.addToResourcePolicy(new iam.PolicyStatement({
    principals: [new iam.ServicePrincipal("s3.amazonaws.com")],
    actions: ["sqs:SendMessage"],
    resources: [queue.queueArn],
    conditions: { ArnLike: { "aws:SourceArn": `arn:aws:s3:::${uploadsName}` } },
  }));
  // L1 bucket: the notification is set natively (CDK's addEventNotification would add a custom resource).
  const uploads = new s3.CfnBucket(stack, "Uploads", {
    bucketName: uploadsName,
    publicAccessBlockConfiguration: {
      blockPublicAcls: true, blockPublicPolicy: true, ignorePublicAcls: true, restrictPublicBuckets: true,
    },
    corsConfiguration: { corsRules: [{
      allowedMethods: ["PUT"], allowedOrigins: ["*"], allowedHeaders: ["*"], maxAge: 3000,
    }] },
    notificationConfiguration: { queueConfigurations: [{ event: "s3:ObjectCreated:*", queue: queue.queueArn }] },
  });
  uploads.applyRemovalPolicy(RemovalPolicy.DESTROY);
  uploads.node.addDependency(queue);
  const uploadsArn = `arn:aws:s3:::${uploadsName}`;

  const media = new s3.Bucket(stack, "Media", {
    bucketName: `${prefix}-media-${account}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: !stack.stageConfig.isLocal,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  // ---------- Events ----------
  const bus = new events.EventBus(stack, "Bus", { eventBusName: `${prefix}-bus` });

  // ---------- Step functions ----------
  const s3Read = new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [`${uploadsArn}/*`] });
  const validateFn = stack.addFunction("validate", "pipeline/validate.ts");
  validateFn.addToRolePolicy(s3Read);
  const resizeFn = stack.addFunction("resize", "pipeline/resize-step.ts", {
    env: { MEDIA_BUCKET: media.bucketName }, tableAccess: false, memorySize: 1024, timeout: 30,
  });
  resizeFn.addToRolePolicy(s3Read);
  media.grantPut(resizeFn);
  const saveFn = stack.addFunction("save", "pipeline/save.ts");
  const failFn = stack.addFunction("fail", "pipeline/fail.ts");

  const invoke = (id: string, fn: typeof saveFn) =>
    new tasks.LambdaInvoke(stack, id, { lambdaFunction: fn, payloadResponseOnly: true, retryOnServiceExceptions: false });

  const markFailed = invoke("MarkFailed", failFn).next(new sfn.Fail(stack, "Failed"));
  const catchAll = <T extends sfn.TaskStateBase>(t: T) => t.addCatch(markFailed, { resultPath: "$.error" });

  const validate = catchAll(invoke("Validate", validateFn));
  const resize = catchAll(invoke("Resize", resizeFn).addRetry({
    errors: ["States.TaskFailed"], maxAttempts: 2, interval: Duration.seconds(2), backoffRate: 2,
  }));
  const save = catchAll(invoke("Save", saveFn));
  const publish = new tasks.EventBridgePutEvents(stack, "Publish", {
    entries: [{
      eventBus: bus,
      source: "ig.posts",
      detailType: "PostPublished",
      detail: sfn.TaskInput.fromObject({ "postId.$": "$.postId", "userId.$": "$.userId" }),
    }],
    resultPath: sfn.JsonPath.DISCARD,
  });
  const done = new sfn.Succeed(stack, "Done");

  const machine = new sfn.StateMachine(stack, "Pipeline", {
    stateMachineName: `${prefix}-pipeline`,
    timeout: Duration.minutes(5),
    definitionBody: sfn.DefinitionBody.fromChainable(
      validate.next(resize).next(save).next(
        new sfn.Choice(stack, "AlreadyDone?")
          .when(sfn.Condition.booleanEquals("$.alreadyDone", true), done)
          .otherwise(publish.next(done)),
      ),
    ),
  });

  const starter = stack.addFunction("starter", "pipeline/starter.ts", {
    env: { STATE_MACHINE_ARN: machine.stateMachineArn }, tableAccess: false,
  });
  machine.grantStartExecution(starter);
  starter.addEventSource(new SqsEventSource(queue, { batchSize: 5, reportBatchItemFailures: true }));

  new CfnOutput(stack, "UploadsBucket", { value: uploadsName });
  new CfnOutput(stack, "MediaBucket", { value: media.bucketName });
  new CfnOutput(stack, "UploadsDlqUrl", { value: dlq.queueUrl });
  new CfnOutput(stack, "PipelineArn", { value: machine.stateMachineArn });

  return { uploadsName, uploadsArn, media, bus, dlq, queue, machine };
}
