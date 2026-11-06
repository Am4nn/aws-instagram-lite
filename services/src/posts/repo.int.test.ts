import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { docClient } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makePostsRepo } from "./repo.js";

const doc = docClient();
const table = process.env.TABLE_NAME!;
const users = makeUsersRepo(doc, table);
const posts = makePostsRepo(doc, table);
const media = { thumb: "media/x/thumb.jpg", full: "media/x/full.jpg", width: 10, height: 10 };

async function newUser() {
  const userId = randomUUID();
  await users.upsertProfile(userId, { username: `p_${userId.slice(0, 8)}`, bio: "" });
  return userId;
}

describe("posts repo (DynamoDB on Floci)", () => {
  it("creates a PENDING post with a ttl, hidden from the user's grid", async () => {
    const userId = await newUser();
    const post = await posts.createPending(userId, { caption: "hi", contentType: "image/png" });
    expect(post).toMatchObject({ userId, caption: "hi", status: "PENDING" });
    expect((await posts.get(post.postId))?.status).toBe("PENDING");
    expect(await posts.listByUser(userId)).toEqual([]);
  });

  it("markReady shows the post in the grid and bumps postCount once", async () => {
    const userId = await newUser();
    const post = await posts.createPending(userId, { caption: "", contentType: "image/png" });
    expect(await posts.markReady(post.postId, media)).toBe(true);
    expect(await posts.markReady(post.postId, media)).toBe(false); // SQS redelivery / retry
    const listed = await posts.listByUser(userId);
    expect(listed.map((p) => p.postId)).toEqual([post.postId]);
    expect(listed[0]).toMatchObject({ status: "READY", media: { thumb: media.thumb } });
    expect((await users.getProfile(userId))?.postCount).toBe(1);
  });

  it("lists newest first", async () => {
    const userId = await newUser();
    const a = await posts.createPending(userId, { caption: "a", contentType: "image/png" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await posts.createPending(userId, { caption: "b", contentType: "image/png" });
    await posts.markReady(a.postId, media);
    await posts.markReady(b.postId, media);
    expect((await posts.listByUser(userId)).map((p) => p.caption)).toEqual(["b", "a"]);
  });

  it("markFailed only affects PENDING posts", async () => {
    const userId = await newUser();
    const p1 = await posts.createPending(userId, { caption: "", contentType: "image/png" });
    expect(await posts.markFailed(p1.postId, "bad image")).toBe(true);
    expect(await posts.get(p1.postId)).toMatchObject({ status: "FAILED", failReason: "bad image" });
    const p2 = await posts.createPending(userId, { caption: "", contentType: "image/png" });
    await posts.markReady(p2.postId, media);
    expect(await posts.markFailed(p2.postId, "late")).toBe(false);
    expect((await posts.get(p2.postId))?.status).toBe("READY");
  });

  it("get returns null for unknown posts", async () => {
    expect(await posts.get(randomUUID())).toBeNull();
  });
});
