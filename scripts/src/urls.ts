/** CDK prints the real-AWS invoke URL; Floci serves the same API on a local hostname. */
export function localApiUrl(awsUrl: string): string {
  const m = /^https?:\/\/([a-z0-9]+)\.execute-api\./.exec(awsUrl);
  if (!m) throw new Error(`not an execute-api URL: ${awsUrl}`);
  return `http://${m[1]}.execute-api.localhost.floci.io:4566`;
}

/** Contents of web/.env.local; ids change on every fresh deploy. */
export function webEnvFile(v: { apiUrl: string; userPoolClientId: string; cognitoEndpoint: string }): string {
  return [
    `NEXT_PUBLIC_API_URL=${v.apiUrl}`,
    `NEXT_PUBLIC_USER_POOL_CLIENT_ID=${v.userPoolClientId}`,
    `NEXT_PUBLIC_COGNITO_ENDPOINT=${v.cognitoEndpoint}`,
    "",
  ].join("\n");
}

/**
 * NEXT_PUBLIC_* for building the web app against real AWS. Passed as process env to `next build`
 * (process env beats web/.env.local, which keeps the local values untouched).
 */
export function awsWebBuildEnv(out: Record<string, string>, region: string): Record<string, string> {
  for (const k of ["ApiUrl", "UserPoolClientId"]) {
    if (!out[k]) throw new Error(`stack output ${k} missing: did the deploy finish?`);
  }
  if (!/^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com/.test(out.ApiUrl)) {
    throw new Error(`${out.ApiUrl} is not a real AWS API URL`);
  }
  return {
    NEXT_PUBLIC_API_URL: out.ApiUrl.replace(/\/$/, ""),
    NEXT_PUBLIC_USER_POOL_CLIENT_ID: out.UserPoolClientId,
    NEXT_PUBLIC_AWS_REGION: region,
    NEXT_PUBLIC_COGNITO_ENDPOINT: "", // empty = Cognito's regional endpoint
    NEXT_PUBLIC_SIGNUP_EMAIL: "required", // pool needs an email + code confirmation
  };
}
