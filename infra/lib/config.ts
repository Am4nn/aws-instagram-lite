export type Stage = "local" | "aws";

export interface StageConfig {
  stage: Stage;
  /** Prefix for every stack and resource name: ig-<stage> */
  prefix: string;
  /** Followers at or above this count make an author a "celeb" (fan-out on read). */
  celebThreshold: number;
  isLocal: boolean;
  /** Where the stack lives: Floci's us-east-1 locally, Mumbai (ap-south-1) on real AWS. */
  region: string;
  /** aws only, optional: email subscribed to the ops alarm topic (-c alertEmail=... or IG_ALERT_EMAIL). */
  alertEmail?: string;
  /** Local only: Floci issues tokens as `${cognitoIssuerBase}/${userPoolId}`. On AWS the issuer comes from the stack region. */
  cognitoIssuerBase?: string;
}

function isFlociEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".floci.io");
  } catch {
    return false;
  }
}

/** Safety guard: local must hit Floci, aws must not have an endpoint override. */
export function loadConfig(
  stage: string | undefined, env: NodeJS.ProcessEnv, context: { alertEmail?: string } = {},
): StageConfig {
  if (stage === "local") {
    if (!isFlociEndpoint(env.AWS_ENDPOINT_URL)) {
      throw new Error(
        "stage=local but AWS_ENDPOINT_URL must point at Floci (e.g. http://localhost:4566). Refusing to touch real AWS.",
      );
    }
    return {
      stage, prefix: "ig-local", celebThreshold: 3, isLocal: true, region: "us-east-1",
      cognitoIssuerBase: "http://127.0.0.1:4566",
    };
  }
  if (stage === "aws") {
    if (env.AWS_ENDPOINT_URL) {
      throw new Error("stage=aws: unset AWS_ENDPOINT_URL first (it is pointing at an emulator).");
    }
    const alertEmail = context.alertEmail || env.IG_ALERT_EMAIL || undefined;
    if (alertEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alertEmail)) {
      throw new Error(`alertEmail "${alertEmail}" is not an email address.`);
    }
    return {
      stage, prefix: "ig-aws", celebThreshold: 10000, isLocal: false, region: "ap-south-1",
      ...(alertEmail ? { alertEmail } : {}),
    };
  }
  throw new Error(`stage must be local or aws (got "${stage}"). Pass -c stage=local`);
}

/** JWT issuer for a user pool: Floci's local URL, or Cognito's regional URL on AWS. */
export function cognitoIssuer(config: StageConfig, region: string, userPoolId: string): string {
  return config.cognitoIssuerBase
    ? `${config.cognitoIssuerBase}/${userPoolId}`
    : `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}
