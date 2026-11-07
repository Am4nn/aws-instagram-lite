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
      // Browser presigned PUTs: from the CloudFront site only on aws, any origin locally.
      allowedMethods: ["PUT"], allowedOrigins: stack.webOrigins ?? ["*"], allowedHeaders: ["*"], maxAge: 3000,
    }] },
    notificationConfiguration: { queueConfigurations: [{ event: "s3:ObjectCreated:*", queue: queue.queueArn }] },
    // Originals are only needed until the pipeline has made the JPEGs; rejected/abandoned ones vanish too.
    lifecycleConfiguration: { rules: [{ id: "expire-originals", status: "Enabled", prefix: "uploads/", expirationInDays: 1 }] },
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
    env: { MEDIA_BUCKET: media.bucketName }, tableAccess: false, memorySize: 1536, timeout: 30, // ~40 MP decodes in memory
  });
  resizeFn.addToRolePolicy(s3Read);
  media.grantPut(resizeFn);
  const saveFn = stack.addFunction("save", "pipeline/save.ts");
  const failFn = stack.addFunction("fail", "pipeline/fail.ts");

  // One explicit retry policy per step (instead of CDK's default service-exception retrier):
  //  - InvalidUploadError (bad image, wrong owner…) is final: never retried, goes straight to MarkFailed
  //  - anything else (throttling, timeouts, a DynamoDB conflict) is transient: 3 retries, exponential
  //    backoff with jitter, so a burst of failures doesn't retry in lock-step
  const retryTransient = <T extends sfn.TaskStateBase>(t: T, final = true) => {
    if (final) t.addRetry({ errors: ["InvalidUploadError"], maxAttempts: 0 });
    return t.addRetry({
      errors: [sfn.Errors.ALL], maxAttempts: 3, interval: Duration.seconds(1), backoffRate: 2,
      jitterStrategy: sfn.JitterType.FULL,
    });
  };
  const invoke = (id: string, fn: typeof saveFn, resultPath?: string) =>
    new tasks.LambdaInvoke(stack, id, {
      lambdaFunction: fn, payloadResponseOnly: true, retryOnServiceExceptions: false,
      ...(resultPath ? { resultPath } : {}),
    });

  // After marking the post FAILED: a bad upload is the user's problem (Succeed "Rejected", no alarm);
  // anything else is ours (Fail → counts as a failed execution → ig-<stage>-pipeline-failed alarm).
  const markFailed = retryTransient(invoke("MarkFailed", failFn, "$.markFailed"), false).next(
    new sfn.Choice(stack, "UserError?")
      .when(sfn.Condition.stringEquals("$.error.Error", "InvalidUploadError"), new sfn.Succeed(stack, "Rejected"))
      .otherwise(new sfn.Fail(stack, "Failed")),
  );
  const catchAll = <T extends sfn.TaskStateBase>(t: T) => t.addCatch(markFailed, { resultPath: "$.error" });

  const validate = catchAll(retryTransient(invoke("Validate", validateFn)));
  const resize = catchAll(retryTransient(invoke("Resize", resizeFn)));
  const save = catchAll(retryTransient(invoke("Save", saveFn)));
  const publish = retryTransient(new tasks.EventBridgePutEvents(stack, "Publish", {
    entries: [{
      eventBus: bus,
      source: "ig.posts",
      detailType: "PostPublished",
      detail: sfn.TaskInput.fromObject({ "postId.$": "$.postId", "userId.$": "$.userId" }),
    }],
    resultPath: sfn.JsonPath.DISCARD,
  }), false);
  // The post is already READY here; if the event still can't be sent, fail loudly (alarm in step 6).
  publish.addCatch(new sfn.Fail(stack, "PublishFailed", {
    error: "PublishFailed", cause: "post is READY but PostPublished could not be sent",
  }));
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
