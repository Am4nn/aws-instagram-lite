import { describe, it, expect } from "vitest";
import { pageFeed, type Source } from "./page.js";
import type { Ref } from "./merge-types.js";

// Property test (from the steps 6-7 code review): for random feeds, reading every page must return
// exactly the eligible posts, newest first, no skips, no duplicates, always making progress.
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (n: number) => Math.floor(rnd() * n);
const desc = (a: Ref, b: Ref) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0);

// conservative = "truncated whenever a full page came back", like the real DynamoDB-backed sources
const fromArray = (rows: Ref[], conservative: boolean): Source => async (before, limit) => {
  const older = rows.filter((r) => !before || r.sortKey < before).sort(desc);
  const refs = older.slice(0, limit);
  return { refs, truncated: older.length > limit || (conservative && refs.length === limit) };
};

describe("pageFeed property test", () => {
  it("3,000 random feeds: exact eligible posts, newest first, no skips/dups, always progresses", async () => {
    let failures = 0;
    for (let iter = 0; iter < 3000; iter++) {
      const authors = ["me", ...Array.from({ length: 1 + ri(6) }, (_, i) => `a${i}`)];
      const celebSet = new Set(authors.filter((a) => a !== "me" && rnd() < 0.4));
      const following = new Set(authors.filter((a) => a !== "me" && rnd() < 0.6));
      const posts: Ref[] = Array.from({ length: ri(80) }, (_, i) => {
        const t = ri(rnd() < 0.3 ? 5 : 1000); // many timestamp ties
        return { postId: `p${i}`, authorId: authors[ri(authors.length)], sortKey: `${String(t).padStart(4, "0")}#p${i}` };
      });
      // pushed feed: own posts, non-celeb posts (some from people since unfollowed), some pre-registration celeb posts
      const feed = posts.filter((p) => p.authorId === "me" || (!celebSet.has(p.authorId) ? rnd() < 0.8 : rnd() < 0.3));
      const celebSources = [...celebSet].filter((c) => following.has(c)).map((c) => posts.filter((p) => p.authorId === c));
      const eligible = new Set<string>();
      for (const p of feed) if (p.authorId === "me" || following.has(p.authorId)) eligible.add(p.postId);
      for (const src of celebSources) for (const p of src) eligible.add(p.postId);
      const expected = posts.filter((p) => eligible.has(p.postId)).sort(desc).map((p) => p.postId);

      const limit = 1 + ri(6);
      const conservative = rnd() < 0.5;
      const maxRounds = 1 + ri(4);
      const got: string[] = [];
      let cursor: string | undefined;
      let ok = true;
      for (let pages = 0; ; pages++) {
        if (pages > 1000) { ok = false; break; }
        const r = await pageFeed({
          me: "me", limit, before: cursor, maxRounds,
          feed: fromArray(feed, conservative),
          celebs: celebSources.map((s) => fromArray(s, conservative)),
          isFollowing: async (ids) => new Set(ids.filter((i) => following.has(i))),
        });
        if (r.items.length > limit) ok = false;
        got.push(...r.items.map((i) => i.postId));
        if (!r.next) break;
        if (cursor !== undefined && r.next >= cursor) { ok = false; break; } // must move strictly older
        cursor = r.next;
      }
      if (!ok || JSON.stringify(got) !== JSON.stringify(expected)) failures++;
    }
    expect(failures).toBe(0);
  });
});
