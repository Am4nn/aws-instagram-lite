import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { check, assert, type Outputs } from "./util.js";

export async function run(o: Outputs) {
  const sm = new SecretsManagerClient({});
  return [
    await check("Secrets Manager", "CDK-generated secret readable via GetSecretValue", async () => {
      const r = await sm.send(new GetSecretValueCommand({ SecretId: o.SecretArn }));
      assert((r.SecretString ?? "").length >= 16, "secret empty or short");
      return `${r.SecretString!.length} chars`;
    }),
  ];
}
