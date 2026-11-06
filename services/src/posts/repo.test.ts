import { describe, it, expect } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { makePostsRepo } from "./repo.js";

/** Fake client: Get returns a post with `status`; TransactWrite is cancelled (as under contention). */
function fakeDoc(statusAfterCancel: string): DynamoDBDocumentClient {
  return {
    send: async (cmd: { constructor: { name: string } }) => {
      if (cmd.constructor.name === "GetCommand") {
        return { Item: { postId: "p1", userId: "u1", status: statusAfterCancel, createdAt: "t" } };
      }
      throw Object.assign(new Error("Transaction cancelled"), { name: "TransactionCanceledException" });
    },
  } as unknown as DynamoDBDocumentClient;
}

const media = { thumb: "t", full: "f", width: 1, height: 1 };

describe("markReady under contention (real DynamoDB cancels on conflicts too)", () => {
  it("returns false only when the post is genuinely no longer PENDING", async () => {
    expect(await makePostsRepo(fakeDoc("READY"), "t").markReady("p1", media)).toBe(false);
  });

  it("rethrows when the post is still PENDING (a conflict, not 'already done'), so the step retries", async () => {
    await expect(makePostsRepo(fakeDoc("PENDING"), "t").markReady("p1", media)).rejects.toThrow(/cancelled/);
  });
});
