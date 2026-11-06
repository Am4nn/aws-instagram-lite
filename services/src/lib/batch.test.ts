import { describe, it, expect } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { batchGetAll } from "./batch.js";

/** Fake BatchGet: hands back the first `throttled` calls' keys as unprocessed (throttling). */
function fakeDoc(throttled: number) {
  let calls = 0;
  const doc = {
    send: async (cmd: { input: { RequestItems: Record<string, { Keys: { id: string }[] }> } }) => {
      const keys = cmd.input.RequestItems.t.Keys;
      calls++;
      if (calls <= throttled) return { Responses: { t: [] }, UnprocessedKeys: { t: { Keys: keys } } };
      return { Responses: { t: keys.map((k) => ({ ...k, found: true })) } };
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, calls: () => calls };
}

describe("batchGetAll", () => {
  it("retries unprocessed keys (with backoff) until all come back, in chunks of 100", async () => {
    const f = fakeDoc(2);
    const keys = Array.from({ length: 150 }, (_, i) => ({ id: String(i) }));
    const items = await batchGetAll(f.doc, "t", keys);
    expect(items).toHaveLength(150);
  });

  it("throws instead of silently dropping keys when throttling never clears", async () => {
    await expect(batchGetAll(fakeDoc(99).doc, "t", [{ id: "1" }])).rejects.toThrow(/unprocessed/);
  });

  it("does nothing for no keys", async () => {
    const f = fakeDoc(0);
    expect(await batchGetAll(f.doc, "t", [])).toEqual([]);
    expect(f.calls()).toBe(0);
  });
});
