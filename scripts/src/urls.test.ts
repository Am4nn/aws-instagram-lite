import { describe, it, expect } from "vitest";
import { awsWebBuildEnv, localApiUrl, webEnvFile } from "./urls.js";

describe("localApiUrl", () => {
  it("maps the amazonaws.com HTTP API endpoint to Floci's local hostname", () => {
    expect(localApiUrl("https://fea9a93bc9.execute-api.us-east-1.amazonaws.com"))
      .toBe("http://fea9a93bc9.execute-api.localhost.floci.io:4566");
  });

  it("throws on something that is not an execute-api URL", () => {
    expect(() => localApiUrl("https://example.com")).toThrow(/not an execute-api URL/);
  });
});

describe("webEnvFile", () => {
  it("writes API URL, Cognito client id and Cognito endpoint for Next.js", () => {
    expect(webEnvFile({
      apiUrl: "http://abc.execute-api.localhost.floci.io:4566",
      userPoolClientId: "client123",
      cognitoEndpoint: "http://localhost:4566",
    })).toBe(
      "NEXT_PUBLIC_API_URL=http://abc.execute-api.localhost.floci.io:4566\n" +
      "NEXT_PUBLIC_USER_POOL_CLIENT_ID=client123\n" +
      "NEXT_PUBLIC_COGNITO_ENDPOINT=http://localhost:4566\n",
    );
  });
});

describe("awsWebBuildEnv", () => {
  const out = { ApiUrl: "https://abc.execute-api.ap-southeast-2.amazonaws.com/", UserPoolClientId: "client123" };

  it("points the web build at the real API + Cognito in the region, with email sign-up", () => {
    expect(awsWebBuildEnv(out, "ap-southeast-2")).toEqual({
      NEXT_PUBLIC_API_URL: "https://abc.execute-api.ap-southeast-2.amazonaws.com",
      NEXT_PUBLIC_USER_POOL_CLIENT_ID: "client123",
      NEXT_PUBLIC_AWS_REGION: "ap-southeast-2",
      NEXT_PUBLIC_COGNITO_ENDPOINT: "", // must be set (empty) so web/.env.local's Floci URL is not used
      NEXT_PUBLIC_SIGNUP_EMAIL: "required",
    });
  });

  it("refuses outputs from a failed or partial deploy", () => {
    expect(() => awsWebBuildEnv({ ApiUrl: out.ApiUrl }, "ap-southeast-2")).toThrow(/UserPoolClientId/);
    expect(() => awsWebBuildEnv({ ...out, ApiUrl: "http://x.execute-api.localhost.floci.io:4566" }, "ap-southeast-2"))
      .toThrow(/not a real AWS API URL/);
  });
});
