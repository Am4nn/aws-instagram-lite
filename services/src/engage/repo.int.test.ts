import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { docClient } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makePostsRepo } from "../posts/repo.js";
import { makeEngageRepo } from "./repo.js";

const doc = docClient();
const table = process.env.TABLE_NAME!;
const users = makeUsersRepo(doc, table);
const posts = makePostsRepo(doc, table);
const engage = makeEngageRepo(doc, table);
const media = { thumb: "t", full: "f", width: 1, height: 1 };

async function readyPost() {
  const userId = randomUUID();
  await users.upsertProfile(userId, { username: `e_${userId.slice(0, 8)}`, bio: "" });
  const p = await posts.createPending(userId, { caption: "", contentType: "image/png" });
  await posts.markReady(p.postId, media);
  return (await posts.get(p.postId))!;
}

describe("engage repo (DynamoDB on Floci)", () => {
  it("like is idempotent and keeps likeCount exact", async () => {
    const post = await readyPost();
    const [a, b] = [randomUUID(), randomUUID()];
    expect(await engage.like(post, a)).toBe(true);
    expect(await engage.like(post, a)).toBe(false);
    expect(await engage.like(post, b)).toBe(true);
    expect((await posts.get(post.postId))?.likeCount).toBe(2);
    expect(await engage.unlike(post.postId, a)).toBe(true);
    expect(await engage.unlike(post.postId, a)).toBe(false);
    expect((await posts.get(post.postId))?.likeCount).toBe(1);
    expect(await engage.likedBy([post.postId], b)).toEqual(new Set([post.postId]));
    expect(await engage.likedBy([post.postId], a)).toEqual(new Set());
  });

  it("adds comments (oldest first, paged) and counts them", async () => {
    const post = await readyPost();
    const u = { userId: randomUUID(), username: "commenter" };
    for (const text of ["one", "two", "three"]) {
      await engage.addComment(post, u, text);
      await new Promise((r) => setTimeout(r, 3));
    }
    const p1 = await engage.listComments(post.postId, undefined, 2);
    expect(p1.items.map((c) => c.text)).toEqual(["one", "two"]);
    expect(p1.items[0]).toMatchObject({ username: "commenter", userId: u.userId });
    const p2 = await engage.listComments(post.postId, p1.next, 2);
    expect(p2.items.map((c) => c.text)).toEqual(["three"]);
    expect(p2.next).toBeUndefined();
    expect((await posts.get(post.postId))?.commentCount).toBe(3);
  });
});
