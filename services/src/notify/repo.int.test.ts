import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { docClient } from "../lib/db.js";
import { makeNotifsRepo } from "./repo.js";

const repo = makeNotifsRepo(docClient(), process.env.TABLE_NAME!);
const n = (recipientId: string, at: string, key: string) => ({
  recipientId, type: "PostLiked" as const, actorId: "carol", actorUsername: "carol", postId: "p1", at, sourceKey: key,
});

describe("notifications repo (DynamoDB on Floci)", () => {
  it("lists newest first, counts unread, and mark-all-read resets the count", async () => {
    const me = randomUUID();
    await repo.put(n(me, "2026-01-01T00:00:01Z", "a"));
    await repo.put(n(me, "2026-01-01T00:00:02Z", "b"));
    const list = await repo.list(me);
    expect(list.map((x) => x.at)).toEqual(["2026-01-01T00:00:02Z", "2026-01-01T00:00:01Z"]);
    expect(list[0]).toMatchObject({ type: "PostLiked", actorUsername: "carol", postId: "p1" });
    expect(await repo.unreadCount(me)).toBe(2);
    await repo.markAllRead(me, "2026-01-01T00:00:01Z");
    expect(await repo.unreadCount(me)).toBe(1);
    await repo.markAllRead(me, "2026-01-02T00:00:00Z");
    expect(await repo.unreadCount(me)).toBe(0);
  });

  it("is idempotent: the same source event stored twice is one notification", async () => {
    const me = randomUUID();
    await repo.put(n(me, "2026-01-01T00:00:01Z", "same"));
    await repo.put(n(me, "2026-01-01T00:00:01Z", "same"));
    expect(await repo.list(me)).toHaveLength(1);
  });
});
