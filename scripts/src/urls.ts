/** CDK prints the real-AWS invoke URL; Floci serves the same API on a local hostname. */
export function localApiUrl(awsUrl: string): string {
  const m = /^https?:\/\/([a-z0-9]+)\.execute-api\./.exec(awsUrl);
  if (!m) throw new Error(`not an execute-api URL: ${awsUrl}`);
  return `http://${m[1]}.execute-api.localhost.floci.io:4566`;
}
