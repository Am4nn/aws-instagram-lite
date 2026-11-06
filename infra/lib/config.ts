export type Stage = "local" | "aws";

export interface StageConfig {
  stage: Stage;
  /** Prefix for every stack and resource name: ig-<stage> */
  prefix: string;
  /** Followers at or above this count make an author a "celeb" (fan-out on read). */
  celebThreshold: number;
  isLocal: boolean;
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
export function loadConfig(stage: string | undefined, env: NodeJS.ProcessEnv): StageConfig {
  if (stage === "local") {
    if (!isFlociEndpoint(env.AWS_ENDPOINT_URL)) {
      throw new Error(
        "stage=local but AWS_ENDPOINT_URL must point at Floci (e.g. http://localhost:4566). Refusing to touch real AWS.",
      );
    }
    return { stage, prefix: "ig-local", celebThreshold: 3, isLocal: true };
  }
  if (stage === "aws") {
    if (env.AWS_ENDPOINT_URL) {
      throw new Error("stage=aws: unset AWS_ENDPOINT_URL first (it is pointing at an emulator).");
    }
    return { stage, prefix: "ig-aws", celebThreshold: 10000, isLocal: false };
  }
  throw new Error(`stage must be local or aws (got "${stage}"). Pass -c stage=local`);
}
