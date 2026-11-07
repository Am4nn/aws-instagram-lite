import { describe, it, expect } from "vitest";
import { devEnvFile, flociEnvFile, localApiUrl, ssrOriginHost } from "./urls.js";

describe("localApiUrl", () => {
  it("maps the amazonaws.com HTTP API endpoint to Floci's local hostname", () => {
    expect(localApiUrl("https://fea9a93bc9.execute-api.us-east-1.amazonaws.com"))
      .toBe("http://fea9a93bc9.execute-api.localhost.floci.io:4566");
  });

  it("throws on something that is not an execute-api URL", () => {
    expect(() => localApiUrl("https://example.com")).toThrow(/not an execute-api URL/);
  });
});

describe("devEnvFile (web/.env.development.local, read by next dev only)", () => {
  it("has the server settings: API, Cognito at Floci, media from Floci S3; no NEXT_PUBLIC_* and no secret", () => {
    const f = devEnvFile({
      apiUrl: "http://abc.execute-api.localhost.floci.io:4566", userPoolClientId: "client123",
      mediaBucket: "ig-local-media-000000000000",
    });
    expect(f).toBe(
      "API_URL=http://abc.execute-api.localhost.floci.io:4566\n" +
      "USER_POOL_CLIENT_ID=client123\n" +
      "COGNITO_ENDPOINT=http://localhost:4566\n" +
      "COGNITO_REGION=us-east-1\n" +
      "MEDIA_DEV_ORIGIN=http://localhost:4566/ig-local-media-000000000000\n",
    );
    expect(f).not.toMatch(/NEXT_PUBLIC|ORIGIN_VERIFY_SECRET/);
  });
});

describe("ssrOriginHost (the Function URL host Floci's CloudFront may proxy to)", () => {
  it("turns Floci's unresolvable 127.0.0.1 URL into the localhost.floci.io host", () => {
    expect(ssrOriginHost("http://abc123.lambda-url.us-east-1.127.0.0.1:4566/")).toBe("abc123.lambda-url.us-east-1.localhost.floci.io");
  });
  it("also accepts the AWS-style URL", () => {
    expect(ssrOriginHost("https://abc123.lambda-url.us-east-1.on.aws/")).toBe("abc123.lambda-url.us-east-1.localhost.floci.io");
  });
  it("throws on anything else", () => {
    expect(() => ssrOriginHost("https://example.com/")).toThrow(/Function URL/);
  });
});

describe("flociEnvFile (repo-root .env, read by docker-compose.yml)", () => {
  it("has the CloudFront origins (CORS) and the SSR origin host", () => {
    expect(flociEnvFile({ webOrigin: "http://d1.cloudfront.localhost.floci.io:4566", ssrOriginHost: "abc.lambda-url.us-east-1.localhost.floci.io" }))
      .toBe(
        "WEB_ORIGIN=http://d1.cloudfront.localhost.floci.io:4566\n" +
        "WEB_ORIGIN_SHORT=http://d1.cloudfront.localhost:4566\n" +
        "SSR_ORIGIN_HOST=abc.lambda-url.us-east-1.localhost.floci.io\n",
      );
  });
});
