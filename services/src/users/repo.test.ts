import { describe, it, expect } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { makeUsersRepo, UsernameTakenError } from "./repo.js";

/** Transactions are cancelled `conflicts` times (contention), then succeed; claims are owned by `claimOwner`. */
function fakeDoc(conflicts: number, claimOwner?: string) {
  let transacts = 0;
  const doc = {
    send: async (cmd: { constructor: { name: string }; input: { Key?: { pk: string } } }) => {
      if (cmd.constructor.name === "GetCommand") {
        const pk = cmd.input.Key!.pk;
        if (pk.startsWith("UNAME#")) return { Item: claimOwner ? { userId: claimOwner } : undefined };
        return { Item: undefined }; // no profile yet
      }
      transacts++;
      if (transacts <= conflicts) throw Object.assign(new Error("cancelled"), { name: "TransactionCanceledException" });
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, transacts: () => transacts };
}

describe("upsertProfile under contention", () => {
  it("retries a transaction cancelled by a conflict (nobody owns the name) and succeeds", async () => {
    const f = fakeDoc(2);
    await expect(makeUsersRepo(f.doc, "t").upsertProfile("u1", { username: "ann", bio: "" }))
      .resolves.toMatchObject({ username: "ann" });
    expect(f.transacts()).toBe(3);
  });

  it("gives up after a few conflicts instead of looping forever", async () => {
    await expect(makeUsersRepo(fakeDoc(10).doc, "t").upsertProfile("u1", { username: "ann", bio: "" }))
      .rejects.toThrow(/cancelled/);
  });

  it("still reports UsernameTakenError when someone else owns the claim", async () => {
    await expect(makeUsersRepo(fakeDoc(10, "u2").doc, "t").upsertProfile("u1", { username: "ann", bio: "" }))
      .rejects.toBeInstanceOf(UsernameTakenError);
  });
});
