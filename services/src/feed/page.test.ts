import { describe, it, expect } from "vitest";
import { pageFeed, type Source } from "./page.js";
import type { Ref } from "./merge-types.js";

const key = (n: number, id: string) => `2026-01-01T00:00:${String(Math.floor(n / 1000)).padStart(2, "0")}.${String(n % 1000).padStart(3, "0")}Z#${id}`;
const ref = (n: number, authorId: string, id = `${authorId}${n}`): Ref => ({ postId: id, authorId, sortKey: key(n, id) });

/** A source behaving like a DynamoDB query: newest first, strictly older than `before`, at most `limit`. */
const fromArray = (rows: Ref[]): Source => async (before, limit) => {
  const older = rows.filter((r) => !before || r.sortKey < before).sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  return { refs: older.slice(0, limit), truncated: older.length > limit };
};

async function readAll(o: { feed: Ref[]; celebs?: Record<string, Ref[]>; following: string[]; me?: string; pageSize?: number }) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const r = await pageFeed({
      me: o.me ?? "me", limit: o.pageSize ?? 10, before: cursor,
      feed: fromArray(o.feed),
      celebs: Object.values(o.celebs ?? {}).map(fromArray),
      isFollowing: async (ids) => new Set(ids.filter((id) => o.following.includes(id))),
    });
    seen.push(...r.items.map((i) => i.postId));
    if (!r.next) return seen;
    cursor = r.next;
  }
  throw new Error("did not terminate");
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("pageFeed (merging paged sources without losing posts)", () => {
  it("follows only a celeb with 20 posts → all 20 reachable across pages", async () => {
    const star = range(20).map((n) => ref(n, "star"));
    const seen = await readAll({ feed: [], celebs: { star }, following: ["star"] });
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it("the 30 newest pushed items are from someone I unfollowed → my 5 followed posts are still reachable", async () => {
    const feed = [...range(30).map((n) => ref(100 + n, "gone")), ...range(5).map((n) => ref(n, "alice"))];
    const seen = await readAll({ feed, following: ["alice"] });
    expect(seen.sort()).toEqual(range(5).map((n) => `alice${n}`).sort());
  });

  it("mixed: a followed post behind 27 unfollowed items + a celeb with 30 posts → nothing skipped, newest first", async () => {
    const feed = [...range(27).map((n) => ref(270 + n, "gone")), ref(269, "alice")];
    const star = range(30).map((n) => ref(n * 10, "star"));
    const seen = await readAll({ feed, celebs: { star }, following: ["alice", "star"] });
    expect(seen).toHaveLength(31);
    expect(new Set(seen).size).toBe(31);
    expect(seen.indexOf("alice269")).toBeLessThan(seen.indexOf("star10"));
  });

  it("dedupes a post that is both pushed and pulled, and keeps my own posts", async () => {
    const shared = ref(5, "star", "s5");
    const seen = await readAll({ feed: [shared, ref(4, "me")], celebs: { star: [shared] }, following: ["star"] });
    expect(seen).toEqual(["s5", "me4"]);
  });

  it("returns exactly `limit` items per full page, newest first", async () => {
    const feed = range(25).map((n) => ref(n, "alice"));
    const r = await pageFeed({ me: "me", limit: 10, feed: fromArray(feed), celebs: [], isFollowing: async () => new Set(["alice"]) });
    expect(r.items.map((i) => i.postId)).toEqual(range(10).map((n) => `alice${26 - n}`));
    expect(r.next).toBe(r.items[9].sortKey);
  });
});
