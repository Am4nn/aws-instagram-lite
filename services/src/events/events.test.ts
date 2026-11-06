import { describe, it, expect } from "vitest";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { marshall } from "@aws-sdk/util-dynamodb";
import { toDomainEvent } from "./map.js";
import { makePublisher } from "./publisher.js";

describe("toDomainEvent (new table item → domain event)", () => {
  it("LIKE item → PostLiked for the post author", () => {
    expect(toDomainEvent({ pk: "POST#p1", sk: "LIKE#carol", postId: "p1", userId: "carol", postAuthorId: "alice", createdAt: "T1" }))
      .toEqual({ source: "ig.engage", detailType: "PostLiked", detail: { postId: "p1", authorId: "alice", actorId: "carol", createdAt: "T1" } });
  });

  it("COMMENT item → PostCommented with the text", () => {
    expect(toDomainEvent({ pk: "POST#p1", sk: "COMMENT#t#c1", postId: "p1", commentId: "c1", userId: "carol", postAuthorId: "alice", text: "nice", createdAt: "T2" }))
      .toEqual({ source: "ig.engage", detailType: "PostCommented",
        detail: { postId: "p1", authorId: "alice", actorId: "carol", commentId: "c1", text: "nice", createdAt: "T2" } });
  });

  it("FOLLOWER item → UserFollowed (same shape step 4's fan-out consumes)", () => {
    expect(toDomainEvent({ pk: "USER#alice", sk: "FOLLOWER#bob", userId: "bob", createdAt: "T3" }))
      .toEqual({ source: "ig.social", detailType: "UserFollowed", detail: { followerId: "bob", followeeId: "alice", createdAt: "T3" } });
  });

  it("everything else (profiles, posts, feed items, FOLLOWS edges) → null", () => {
    for (const sk of ["PROFILE", "POST", "FOLLOWS#x", "UNAME"]) expect(toDomainEvent({ pk: "X", sk })).toBeNull();
    expect(toDomainEvent({ pk: "FEED#u", sk: "2026#p" })).toBeNull();
  });
});

describe("stream publisher", () => {
  const rec = (seq: string, item: Record<string, unknown>, eventName = "INSERT") =>
    ({ eventName, dynamodb: { SequenceNumber: seq, NewImage: marshall(item) } });

  it("publishes mapped INSERTs in one batch and skips the rest", async () => {
    const sent: unknown[][] = [];
    const publish = makePublisher(async (entries) => { sent.push(entries); return entries.map(() => ({ ok: true })); });
    const r = await publish({ Records: [
      rec("1", { pk: "POST#p1", sk: "LIKE#c", postId: "p1", userId: "c", postAuthorId: "a" }),
      rec("2", { pk: "USER#a", sk: "PROFILE" }),
      rec("3", { pk: "POST#p1", sk: "LIKE#d", postId: "p1", userId: "d", postAuthorId: "a" }, "MODIFY"),
    ] } as unknown as DynamoDBStreamEvent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(r).toEqual({ batchItemFailures: [] });
  });

  it("reports the failed record's sequence number so the stream retries from there", async () => {
    const publish = makePublisher(async (entries) => entries.map((_, i) => ({ ok: i === 0 })));
    const r = await publish({ Records: [
      rec("10", { pk: "POST#p", sk: "LIKE#a", postId: "p", userId: "a", postAuthorId: "x" }),
      rec("11", { pk: "POST#p", sk: "LIKE#b", postId: "p", userId: "b", postAuthorId: "x" }),
    ] } as unknown as DynamoDBStreamEvent);
    expect(r).toEqual({ batchItemFailures: [{ itemIdentifier: "11" }] });
  });
});
