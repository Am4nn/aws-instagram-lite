import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { docClient } from "../lib/db.js";
import { makeUsersRepo } from "../users/repo.js";
import { makeFollowsRepo } from "./repo.js";

const doc = docClient();
const table = process.env.TABLE_NAME!;
const users = makeUsersRepo(doc, table);
const follows = makeFollowsRepo(doc, table);

async function newUser() {
  const id = randomUUID();
  await users.upsertProfile(id, { username: `f_${id.slice(0, 8)}`, bio: "" });
  return id;
}
const counts = async (id: string) => {
  const p = await users.getProfile(id);
  return { followers: p!.followerCount, following: p!.followingCount };
};

describe("follows repo (DynamoDB on Floci)", () => {
  it("follow creates both edges and bumps both counters once", async () => {
    const [a, b] = [await newUser(), await newUser()];
    expect(await follows.follow(a, b)).toBe(true);
    expect(await follows.follow(a, b)).toBe(false); // already following: no change
    expect(await counts(a)).toEqual({ followers: 0, following: 1 });
    expect(await counts(b)).toEqual({ followers: 1, following: 0 });
    expect(await follows.isFollowing(a, b)).toBe(true);
    expect(await follows.isFollowing(b, a)).toBe(false);
  });

  it("unfollow removes edges and decrements once", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await follows.follow(a, b);
    expect(await follows.unfollow(a, b)).toBe(true);
    expect(await follows.unfollow(a, b)).toBe(false);
    expect(await counts(a)).toEqual({ followers: 0, following: 0 });
    expect(await counts(b)).toEqual({ followers: 0, following: 0 });
    expect(await follows.isFollowing(a, b)).toBe(false);
  });

  it("lists who I follow and (paged) who follows me", async () => {
    const [star, f1, f2, f3] = [await newUser(), await newUser(), await newUser(), await newUser()];
    for (const f of [f1, f2, f3]) await follows.follow(f, star);
    expect(await follows.listFollowing(f1)).toEqual([star]);
    const pages: string[][] = [];
    for await (const page of follows.listFollowers(star, 2)) pages.push(page);
    expect(pages.flat().sort()).toEqual([f1, f2, f3].sort());
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});
