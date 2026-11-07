/** CDK prints the real-AWS invoke URL; Floci serves the same API on a local hostname. */
export function localApiUrl(awsUrl: string): string {
  const m = /^https?:\/\/([a-z0-9]+)\.execute-api\./.exec(awsUrl);
  if (!m) throw new Error(`not an execute-api URL: ${awsUrl}`);
  return `http://${m[1]}.execute-api.localhost.floci.io:4566`;
}

/**
 * web/.env.development.local: the server settings for `next dev` (Next loads this file only in dev, so
 * nothing here can end up in the Lambda bundle). Ids change on every fresh deploy.
 */
export function devEnvFile(v: { apiUrl: string; userPoolClientId: string; mediaBucket: string }): string {
  return [
    `API_URL=${v.apiUrl}`,
    `USER_POOL_CLIENT_ID=${v.userPoolClientId}`,
    "COGNITO_ENDPOINT=http://localhost:4566",
    "COGNITO_REGION=us-east-1",
    `MEDIA_DEV_ORIGIN=http://localhost:4566/${v.mediaBucket}`,
    "",
  ].join("\n");
}

/**
 * Floci's Function URL (`http://<id>.lambda-url.us-east-1.127.0.0.1:4566/`) doesn't resolve; the same
 * function answers at `<id>.lambda-url.us-east-1.localhost.floci.io`. That exact host must be listed in
 * Floci's FLOCI_SERVICES_CLOUDFRONT_ALLOWED_PRIVATE_ORIGIN_HOSTS (no wildcards).
 */
export function ssrOriginHost(functionUrl: string): string {
  const m = /^https?:\/\/([a-z0-9]+)\.lambda-url\.([a-z0-9-]+)\./.exec(functionUrl);
  if (!m) throw new Error(`not a Lambda Function URL: ${functionUrl}`);
  return `${m[1]}.lambda-url.${m[2]}.localhost.floci.io`;
}

/** Repo-root .env for docker-compose.yml: CloudFront origins (Floci CORS) + the SSR origin host. */
export function flociEnvFile(v: { webOrigin: string; ssrOriginHost: string }): string {
  const short = v.webOrigin.replace(".localhost.floci.io", ".localhost"); // Chrome/Edge resolve *.localhost themselves
  return `WEB_ORIGIN=${v.webOrigin}\nWEB_ORIGIN_SHORT=${short}\nSSR_ORIGIN_HOST=${v.ssrOriginHost}\n`;
}
