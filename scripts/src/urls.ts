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
