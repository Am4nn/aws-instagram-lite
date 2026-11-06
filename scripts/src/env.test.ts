import { describe, it, expect } from "vitest";
import { flociEnv, assertFlociUp, FLOCI_ENDPOINT } from "./env.js";

describe("flociEnv", () => {
  it("points the AWS SDK/CLI at Floci with test keys", () => {
    const env = flociEnv();
    expect(FLOCI_ENDPOINT).toBe("http://localhost:4566");
    expect(env.AWS_ENDPOINT_URL).toBe("http://localhost:4566");
    expect(env.AWS_ACCESS_KEY_ID).toBe("test");
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("test");
    expect(env.AWS_REGION).toBe("us-east-1");
    expect(env.AWS_DEFAULT_REGION).toBe("us-east-1");
  });
});

describe("assertFlociUp", () => {
  it("throws a helpful message when Floci is unreachable", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(assertFlociUp(FLOCI_ENDPOINT, down)).rejects.toThrow(/run `floci start`/);
  });

  it("resolves when Floci answers any HTTP response", async () => {
    const up = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(assertFlociUp(FLOCI_ENDPOINT, up)).resolves.toBeUndefined();
  });
});
