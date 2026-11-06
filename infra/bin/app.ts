import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config.js";
import { CoreStack } from "../lib/core-stack.js";
import { SpikeStack } from "../lib/spike-stack.js";

const app = new App();
const config = loadConfig(app.node.tryGetContext("stage"), process.env);
const env = config.isLocal
  ? { account: "000000000000", region: "us-east-1" }
  : { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" };

new CoreStack(app, `${config.prefix}-core`, { env, config });

// Throwaway Floci compatibility spike: npm run spike
if (app.node.tryGetContext("spike") === "true" && config.isLocal) {
  new SpikeStack(app, `${config.prefix}-spike`, { env, config });
}
