import { describe, it, expect } from "vitest";
import { flociEnv, assertFlociUp, FLOCI_ENDPOINT, localEnv } from "./env.js";

describe("localEnv", () => {
  it("drops real-AWS credential settings so Floci always gets test/test", () => {
    const env = localEnv({
      PATH: "/bin", AWS_PROFILE: "ig", AWS_SESSION_TOKEN: "tok",
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_ACCESS_KEY_ID: "AKIAREAL",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.AWS_PROFILE).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBe("test");
    expect(env.AWS_ENDPOINT_URL).toBe("http://localhost:4566");
  });
});

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
    await expect(assertFlociUp(FLOCI_ENDPOINT, down)).rejects.toThrow(/run `npm run floci:up`/);
  });

  it("resolves when Floci answers any HTTP response", async () => {
    const up = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(assertFlociUp(FLOCI_ENDPOINT, up)).resolves.toBeUndefined();
  });
});
