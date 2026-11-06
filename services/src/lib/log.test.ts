import { describe, it, expect, vi } from "vitest";
import { makeLogger } from "./log.js";

describe("makeLogger (structured JSON logs)", () => {
  it("writes one JSON line with service, level, message and persistent correlation keys", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { lines.push(String(s)); return true; });
    const spy2 = vi.spyOn(console, "info").mockImplementation((s) => { lines.push(String(s)); });
    try {
      const log = makeLogger("fanout");
      log.appendKeys({ messageId: "m1" });
      log.info("fanned out", { postId: "p1", followers: 3 });
    } finally {
      spy.mockRestore();
      spy2.mockRestore();
    }
    const entry = JSON.parse(lines.find((l) => l.includes("fanned out"))!);
    expect(entry).toMatchObject({ service: "fanout", level: "INFO", message: "fanned out", messageId: "m1", postId: "p1", followers: 3 });
  });
});
