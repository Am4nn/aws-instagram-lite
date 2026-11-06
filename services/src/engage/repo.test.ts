import { describe, it, expect } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { makeEngageRepo } from "./repo.js";
import type { Post } from "../posts/repo.js";

const post: Post = { postId: "p1", userId: "alice", caption: "", contentType: "image/png", status: "READY", createdAt: "t", likeCount: 0, commentCount: 0 };
const cancel = () => Object.assign(new Error("cancelled"), { name: "TransactionCanceledException" });

/** Transactions are cancelled `conflicts` times; `rowExists` says whether the comment row is there afterwards. */
function fakeDoc(conflicts: number, rowExists = false) {
  const tokens: string[] = [];
  let transacts = 0;
  const doc = {
    send: async (cmd: { constructor: { name: string }; input: { ClientRequestToken?: string } }) => {
      if (cmd.constructor.name === "GetCommand") return { Item: rowExists ? { pk: "x" } : undefined };
      tokens.push(cmd.input.ClientRequestToken ?? "");
      if (++transacts <= conflicts) throw cancel();
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, tokens, transacts: () => transacts };
}

describe("addComment under contention (viral post: likes and comments hit the same counter)", () => {
  it("retries a conflict with the SAME idempotency token, so a lost-response retry can't double-count", async () => {
    const f = fakeDoc(2);
    const c = await makeEngageRepo(f.doc, "t").addComment(post, { userId: "carol", username: "carol" }, "hi");
    expect(c.text).toBe("hi");
    expect(f.transacts()).toBe(3);
    expect(new Set(f.tokens).size).toBe(1);
    expect(f.tokens[0]).toBeTruthy();
  });

  it("treats a cancellation as success when the comment row already exists", async () => {
    const f = fakeDoc(5, true);
    await expect(makeEngageRepo(f.doc, "t").addComment(post, { userId: "carol", username: "carol" }, "hi")).resolves.toBeTruthy();
    expect(f.transacts()).toBe(1);
  });
});
