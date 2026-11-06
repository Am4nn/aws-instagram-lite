import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { docClient } from "../lib/db.js";
import { makeUsersRepo, UsernameTakenError } from "./repo.js";

const repo = makeUsersRepo(docClient(), process.env.TABLE_NAME!);
const run = randomUUID().slice(0, 6);
const id = () => randomUUID();
const name = (base: string) => `${base}_${run}`;

describe("users repo (DynamoDB on Floci)", () => {
  it("creates a profile readable by id and by username, counters at 0", async () => {
    const userId = id();
    const created = await repo.upsertProfile(userId, { username: name("ann"), bio: "hi" });
    expect(created).toMatchObject({ userId, username: name("ann"), bio: "hi", followerCount: 0, postCount: 0 });
    expect(await repo.getProfile(userId)).toMatchObject({ username: name("ann") });
    expect(await repo.getProfileByUsername(name("ann"))).toMatchObject({ userId });
  });

  it("returns null for unknown users", async () => {
    expect(await repo.getProfile(id())).toBeNull();
    expect(await repo.getProfileByUsername(name("nobody"))).toBeNull();
  });

  it("refuses a username another user already has", async () => {
    await repo.upsertProfile(id(), { username: name("bob"), bio: "" });
    await expect(repo.upsertProfile(id(), { username: name("bob"), bio: "" })).rejects.toBeInstanceOf(UsernameTakenError);
  });

  it("lets exactly one of two simultaneous claims win (race)", async () => {
    const results = await Promise.allSettled([
      repo.upsertProfile(id(), { username: name("race"), bio: "" }),
      repo.upsertProfile(id(), { username: name("race"), bio: "" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UsernameTakenError);
  });

  it("rename frees the old name and keeps the new one unique", async () => {
    const userId = id();
    await repo.upsertProfile(userId, { username: name("old"), bio: "" });
    await repo.upsertProfile(userId, { username: name("new"), bio: "" });
    expect(await repo.getProfileByUsername(name("old"))).toBeNull();
    expect(await repo.getProfileByUsername(name("new"))).toMatchObject({ userId });
    await expect(repo.upsertProfile(id(), { username: name("old"), bio: "" })).resolves.toBeTruthy();
  });

  it("editing the bio keeps the same name and does not reset counters", async () => {
    const userId = id();
    await repo.upsertProfile(userId, { username: name("cat"), bio: "a" });
    const updated = await repo.upsertProfile(userId, { username: name("cat"), bio: "b" });
    expect(updated).toMatchObject({ bio: "b", followerCount: 0, followingCount: 0, postCount: 0 });
  });
});
