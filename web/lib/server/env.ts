/**
 * Server-only settings, read at request time (never baked into the browser bundle):
 *  - Lambda: set by CDK (infra/lib/web.ts)
 *  - next dev: web/.env.development.local, written by `npm run deploy:local`
 */
export function serverEnv() {
  const e = process.env;
  return {
    /** HTTP API base URL (no trailing slash). */
    apiUrl: (e.API_URL ?? "").replace(/\/$/, ""),
    userPoolClientId: e.USER_POOL_CLIENT_ID ?? "",
    cognitoRegion: e.COGNITO_REGION || "us-east-1",
    /** Floci's Cognito in next dev. Unset in the Lambda (Floci injects AWS_ENDPOINT_URL there; AWS uses the regional endpoint). */
    cognitoEndpoint: e.COGNITO_ENDPOINT || undefined,
    /** aws stage: sign-up needs an email and a confirmation code. */
    emailSignup: e.SIGNUP_EMAIL === "required",
    /** aws stage (https): cookies get the Secure flag. */
    secureCookies: e.SECURE_COOKIES === "true",
    /** Extra browser origins allowed on /bff/* mutations (e.g. the custom domain). */
    siteOrigins: (e.SITE_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    /** CloudFront's x-origin-verify secret. Unset in next dev = check off. */
    originSecret: e.ORIGIN_VERIFY_SECRET || undefined,
  };
}
