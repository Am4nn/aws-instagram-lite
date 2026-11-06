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
  it("writes the API URL for Next.js to read at build/dev time", () => {
    expect(webEnvFile("http://abc.execute-api.localhost.floci.io:4566"))
      .toBe("NEXT_PUBLIC_API_URL=http://abc.execute-api.localhost.floci.io:4566\n");
  });
});
