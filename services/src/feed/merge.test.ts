import { describe, it, expect } from "vitest";
import { signCursor, verifyCursor } from "./cursor.js";
import { mergeFeed, type Ref } from "./merge.js";

describe("cursor", () => {
  const key = "k".repeat(32);
  it("round-trips a signed position", () => {
    expect(verifyCursor(signCursor("2026-01-01T00:00:00Z#p1", key), key)).toBe("2026-01-01T00:00:00Z#p1");
  });
  it("rejects tampered, foreign-key and garbage cursors", () => {
    const good = signCursor("2026-01-01T00:00:00Z#p1", key);
    const [body, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ before: "9999" })).toString("base64url") + "." + sig;
    expect(verifyCursor(forged, key)).toBeNull();
    expect(verifyCursor(good, "other-key")).toBeNull();
    expect(verifyCursor(body, key)).toBeNull();
    expect(verifyCursor("!!!", key)).toBeNull();
  });
});

describe("mergeFeed", () => {
  const r = (postId: string, authorId: string, day: number): Ref =>
    ({ postId, authorId, sortKey: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z#${postId}` });

  it("merges pushed feed items with pulled celeb posts, newest first", () => {
    const out = mergeFeed({
      feedItems: [r("a1", "alice", 3), r("a0", "alice", 1)],
      celebPosts: [r("s1", "star", 2)],
      following: new Set(["alice", "star"]), me: "bob", limit: 10,
    });
    expect(out.items.map((i) => i.postId)).toEqual(["a1", "s1", "a0"]);
    expect(out.next).toBeUndefined();
  });

  it("drops authors I no longer follow but keeps my own posts", () => {
    const out = mergeFeed({
      feedItems: [r("a1", "alice", 3), r("m1", "bob", 2)],
      celebPosts: [], following: new Set(), me: "bob", limit: 10,
    });
    expect(out.items.map((i) => i.postId)).toEqual(["m1"]);
  });

  it("dedupes a post present in both sources (author became a celeb after fan-out)", () => {
    const out = mergeFeed({
      feedItems: [r("s1", "star", 2)], celebPosts: [r("s1", "star", 2)],
      following: new Set(["star"]), me: "bob", limit: 10,
    });
    expect(out.items).toHaveLength(1);
  });

  it("pages: returns limit items and next = last sortKey when more remain", () => {
    const items = [5, 4, 3, 2, 1].map((d) => r(`p${d}`, "alice", d));
    const out = mergeFeed({ feedItems: items, celebPosts: [], following: new Set(["alice"]), me: "bob", limit: 2 });
    expect(out.items.map((i) => i.postId)).toEqual(["p5", "p4"]);
    expect(out.next).toBe(items[1].sortKey);
  });
});
