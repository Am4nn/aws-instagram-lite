import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type { StageConfig } from "./config.js";

export interface SpikeStackProps extends StackProps {
  config: StageConfig;
}

/** Throwaway stack: one of every service Instagram-lite needs, to prove Floci runs them. */
export class SpikeStack extends Stack {
  constructor(scope: Construct, id: string, props: SpikeStackProps) {
    super(scope, id, props);
    const p = `${props.config.prefix}-spike`;
    const out = (name: string, value: string) => new CfnOutput(this, name, { value });
    const inline = (name: string, code: string) =>
      new lambda.Function(this, name, {
        functionName: `${p}-${name.toLowerCase()}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(code),
        timeout: Duration.seconds(10),
      });

    // Cognito + JWT-protected route
    const pool = new cognito.UserPool(this, "Pool", {
      userPoolName: `${p}-users`,
      selfSignUpEnabled: true,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 8, requireSymbols: false, requireUppercase: false },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const client = pool.addClient("Client", { authFlows: { userPassword: true }, generateSecret: false });
    const issuer = `${props.config.cognitoIssuerBase}/${pool.userPoolId}`;
    const privateFn = inline(
      "Private",
      "exports.handler = async (e) => ({ statusCode: 200, headers: {'content-type':'application/json'}, body: JSON.stringify({ sub: e.requestContext.authorizer.jwt.claims.sub }) });",
    );
    const api = new apigwv2.HttpApi(this, "Api", { apiName: `${p}-api` });
    api.addRoutes({
      path: "/private",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("PrivateInt", privateFn),
      authorizer: new HttpJwtAuthorizer("Jwt", issuer, { jwtAudience: [client.userPoolClientId] }),
    });
    out("UserPoolId", pool.userPoolId);
    out("ClientId", client.userPoolClientId);
    out("ApiUrl", api.apiEndpoint);
    out("Issuer", issuer);

    // S3 ObjectCreated → SQS, set on the bucket itself (no CDK notifications custom resource)
    const bucketName = `${p}-uploads`;
    const uploadQueue = new sqs.Queue(this, "UploadQueue", { queueName: `${p}-uploads` });
    uploadQueue.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("s3.amazonaws.com")],
      actions: ["sqs:SendMessage"],
      resources: [uploadQueue.queueArn],
      conditions: { ArnLike: { "aws:SourceArn": `arn:aws:s3:::${bucketName}` } },
    }));
    const bucket = new s3.CfnBucket(this, "Uploads", {
      bucketName,
      notificationConfiguration: {
        queueConfigurations: [{ event: "s3:ObjectCreated:*", queue: uploadQueue.queueArn }],
      },
    });
    bucket.applyRemovalPolicy(RemovalPolicy.DESTROY);
    bucket.node.addDependency(uploadQueue);
    out("UploadBucket", bucketName);
    out("UploadQueueUrl", uploadQueue.queueUrl);

    // Step Functions: Pass → Lambda → Succeed
    const echo = inline("Echo", "exports.handler = async (e) => ({ echoed: e });");
    const machine = new sfn.StateMachine(this, "Machine", {
      stateMachineName: `${p}-machine`,
      definitionBody: sfn.DefinitionBody.fromChainable(
        new sfn.Pass(this, "Start")
          .next(new tasks.LambdaInvoke(this, "Invoke", { lambdaFunction: echo, payloadResponseOnly: true }))
          .next(new sfn.Succeed(this, "Done")),
      ),
    });
    out("StateMachineArn", machine.stateMachineArn);

    // EventBridge custom bus → SQS
    const bus = new events.EventBus(this, "Bus", { eventBusName: `${p}-bus` });
    const eventsQueue = new sqs.Queue(this, "EventsQueue", { queueName: `${p}-events` });
    new events.Rule(this, "Rule", {
      eventBus: bus,
      eventPattern: { source: ["ig.spike"] },
      targets: [new targets.SqsQueue(eventsQueue)],
    });
    out("BusName", bus.eventBusName);
    out("EventsQueueUrl", eventsQueue.queueUrl);

    // SNS → SQS (raw delivery)
    const topic = new sns.Topic(this, "Topic", { topicName: `${p}-topic` });
    const snsQueue = new sqs.Queue(this, "SnsQueue", { queueName: `${p}-sns` });
    topic.addSubscription(new subs.SqsSubscription(snsQueue, { rawMessageDelivery: true }));
    out("TopicArn", topic.topicArn);
    out("SnsQueueUrl", snsQueue.queueUrl);

    // Secrets Manager
    const secret = new secrets.Secret(this, "Secret", {
      secretName: `${p}-secret`,
      generateSecretString: { passwordLength: 32, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    out("SecretArn", secret.secretArn);

    // CloudWatch alarm on DLQ depth → SNS topic
    const dlq = new sqs.Queue(this, "Dlq", { queueName: `${p}-dlq` });
    const alarm = new cloudwatch.Alarm(this, "DlqAlarm", {
      alarmName: `${p}-dlq-not-empty`,
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });
    alarm.addAlarmAction(new cwActions.SnsAction(topic));
    out("AlarmName", alarm.alarmName);
    out("DlqUrl", dlq.queueUrl);
  }
}
