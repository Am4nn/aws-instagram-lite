import { fileURLToPath } from "node:url";
import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { cognitoIssuer, type StageConfig } from "./config.js";

/** Path to a handler file in services/src */
export const servicePath = (file: string) =>
  fileURLToPath(new URL(`../../services/src/${file}`, import.meta.url));

export interface CoreStackProps extends StackProps {
  config: StageConfig;
}

export class CoreStack extends Stack {
  readonly table: dynamodb.Table;
  readonly api: apigwv2.HttpApi;
  readonly userPool: cognito.UserPool;
  readonly authorizer: HttpJwtAuthorizer;
  private readonly config: StageConfig;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);
    this.config = props.config;
    const { prefix } = props.config;

    // ---------- Data: one table for everything (single-table design) ----------
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

    // ---------- Auth: Cognito user pool ----------
    const preSignUp = this.addFunction("presignup", "auth/presignup.ts", { tableAccess: false });
    this.userPool = new cognito.UserPool(this, "Users", {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: true,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 8, requireSymbols: false, requireUppercase: false, requireDigits: false },
      lambdaTriggers: { preSignUp },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const client = this.userPool.addClient("Web", {
      userPoolClientName: `${prefix}-web`,
      authFlows: { userPassword: true },
      generateSecret: false,
    });
    this.authorizer = new HttpJwtAuthorizer(
      "Jwt",
      cognitoIssuer(props.config, this.region, this.userPool.userPoolId),
      { jwtAudience: [client.userPoolClientId] },
    );

    // ---------- API ----------
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
    this.route("GET", "/health", this.addFunction("health", "health.ts"), { public: true });

    const users = this.addFunction("users", "users/handler.ts");
    this.route("GET", "/me", users);
    this.route("PUT", "/me", users);
    this.route("GET", "/users/{username}", users);

    new CfnOutput(this, "ApiUrl", { value: this.api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: this.table.tableName });
    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
  }

  /** A Lambda from services/src with STAGE + TABLE_NAME env and (by default) table read/write. */
  addFunction(
    name: string, entry: string, opts: { env?: Record<string, string>; tableAccess?: boolean } = {},
  ): NodejsFunction {
    const fn = new NodejsFunction(this, `Fn-${name}`, {
      functionName: `${this.config.prefix}-${name}`,
      entry: servicePath(entry),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { STAGE: this.config.stage, TABLE_NAME: this.table.tableName, ...opts.env },
      bundling: { minify: true },
    });
    if (opts.tableAccess !== false) this.table.grantReadWriteData(fn);
    return fn;
  }

  /** Adds a route; JWT-protected unless `public`. */
  route(method: string, path: string, fn: lambda.IFunction, opts: { public?: boolean } = {}) {
    this.api.addRoutes({
      path,
      methods: [method as apigwv2.HttpMethod],
      integration: new HttpLambdaIntegration(`Int-${method}-${path}`, fn),
      authorizer: opts.public ? undefined : this.authorizer,
    });
  }
}
