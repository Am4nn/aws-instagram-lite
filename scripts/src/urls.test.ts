import { describe, it, expect } from "vitest";
import { localApiUrl, webEnvFile } from "./urls.js";

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
