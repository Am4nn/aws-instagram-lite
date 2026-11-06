import { describe, it, expect, beforeEach } from "vitest";
import { handler } from "./health.js";

describe("GET /health", () => {
  beforeEach(() => { process.env.STAGE = "local"; });

  it("returns 200 JSON with ok, stage and time", async () => {
    const res = await handler();
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["content-type"]).toBe("application/json");
    const body = JSON.parse(res.body as string);
    expect(body.ok).toBe(true);
    expect(body.stage).toBe("local");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
