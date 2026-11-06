import {
  CognitoIdentityProviderClient, SignUpCommand, AdminConfirmSignUpCommand, InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { localApiUrl } from "../urls.js";
import { check, assert, type Outputs } from "./util.js";

export async function run(o: Outputs) {
  const idp = new CognitoIdentityProviderClient({});
  const username = `spike${Date.now()}`;
  const password = "Passw0rd-spike";
  let idToken = "";
  const url = `${localApiUrl(o.ApiUrl)}/private`;
  return [
    await check("Cognito", "SignUp → AdminConfirmSignUp → InitiateAuth (USER_PASSWORD_AUTH)", async () => {
      await idp.send(new SignUpCommand({ ClientId: o.ClientId, Username: username, Password: password }));
      await idp.send(new AdminConfirmSignUpCommand({ UserPoolId: o.UserPoolId, Username: username }));
      const r = await idp.send(new InitiateAuthCommand({
        ClientId: o.ClientId, AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }));
      idToken = r.AuthenticationResult?.IdToken ?? "";
      assert(idToken, "no IdToken returned");
      const iss = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).iss;
      return `issuer ${iss}`;
    }),
    await check("API Gateway + Cognito", "HTTP API JWT authorizer accepts a valid token", async () => {
      const res = await fetch(url, { headers: { authorization: `Bearer ${idToken}` } });
      const body = await res.text();
      assert(res.status === 200, `status ${res.status}: ${body.slice(0, 120)}`);
      assert(JSON.parse(body).sub, "no sub in response");
      return "200, sub read from JWT claims";
    }),
    await check("API Gateway + Cognito", "HTTP API JWT authorizer rejects a missing token", async () => {
      const res = await fetch(url);
      assert(res.status === 401, `expected 401, got ${res.status}`);
      return "401";
    }),
  ];
}
