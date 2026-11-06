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

/** Fails fast with a clear message instead of a hung CDK/SDK call. */
export async function assertFlociUp(
  endpoint: string = FLOCI_ENDPOINT,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchFn(`${endpoint}/_floci/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error(`Floci not reachable at ${endpoint} — run \`floci start\``);
  }
}
