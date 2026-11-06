export const FLOCI_ENDPOINT = "http://localhost:4566";

/** Env vars that point the AWS CLI, SDK and CDK at Floci. */
export function flociEnv(): Record<string, string> {
  return {
    AWS_ENDPOINT_URL: FLOCI_ENDPOINT,
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_REGION: "us-east-1",
    AWS_DEFAULT_REGION: "us-east-1",
  };
}

/** Settings that would make the SDK/CDK use real credentials instead of Floci's test keys. */
const REAL_AWS_VARS = ["AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS"];

/** `base` with real-AWS credential settings removed and Floci's env applied. */
export function localEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const k of REAL_AWS_VARS) delete env[k];
  return { ...env, ...flociEnv() };
}

/** Points this process (SDK clients created afterwards) at Floci only. */
export function useLocalEnv(): void {
  for (const k of REAL_AWS_VARS) delete process.env[k];
  Object.assign(process.env, flociEnv());
}

/** Fails fast with a clear message instead of a hung CDK/SDK call. */
export async function assertFlociUp(
  endpoint: string = FLOCI_ENDPOINT,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchFn(`${endpoint}/_floci/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error(`Floci not reachable at ${endpoint} — run \`npm run floci:up\``);
  }
}
