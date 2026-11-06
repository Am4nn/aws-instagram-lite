import { fileURLToPath } from "node:url";
import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { StageConfig } from "./config.js";

/** Path to a handler file in services/src */
export const servicePath = (file: string) =>
  fileURLToPath(new URL(`../../services/src/${file}`, import.meta.url));

export interface CoreStackProps extends StackProps {
  config: StageConfig;
}

export class CoreStack extends Stack {
  readonly table: dynamodb.Table;
  readonly api: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);
    const { prefix, stage } = props.config;

    this.table = new dynamodb.Table(this, "Main", {
      tableName: `${prefix}-main`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    const health = new NodejsFunction(this, "Health", {
      functionName: `${prefix}-health`,
      entry: servicePath("health.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { STAGE: stage, TABLE_NAME: this.table.tableName },
      bundling: { minify: true },
    });

    this.api = new apigwv2.HttpApi(this, "Api", {
      apiName: `${prefix}-api`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["authorization", "content-type"],
      },
    });
    this.api.addRoutes({
      path: "/health",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("HealthInt", health),
    });

    new CfnOutput(this, "ApiUrl", { value: this.api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: this.table.tableName });
  }
}
