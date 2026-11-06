import { describe, it, expect } from "vitest";
import { conditionalWrite } from "./tx.js";

const cancel = () => Object.assign(new Error("cancelled"), { name: "TransactionCanceledException" });

describe("conditionalWrite (tell 'already done' apart from a conflict)", () => {
  it("returns true when the write succeeds", async () => {
    expect(await conditionalWrite(async () => {}, async () => false)).toBe(true);
  });

  it("returns false when cancelled and the state shows it was already done", async () => {
    expect(await conditionalWrite(async () => { throw cancel(); }, async () => true)).toBe(false);
  });

  it("retries when cancelled by a conflict (not done yet), then succeeds", async () => {
    let tries = 0;
    const ok = await conditionalWrite(async () => { if (++tries < 3) throw cancel(); }, async () => false);
    expect(ok).toBe(true);
    expect(tries).toBe(3);
  });

  it("throws after a few conflicts instead of pretending it worked", async () => {
    await expect(conditionalWrite(async () => { throw cancel(); }, async () => false)).rejects.toThrow(/cancelled/);
  });

  it("rethrows other errors immediately", async () => {
    await expect(conditionalWrite(async () => { throw new Error("boom"); }, async () => true)).rejects.toThrow("boom");
  });
});
