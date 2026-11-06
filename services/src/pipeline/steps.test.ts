import { describe, it, expect } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { makeStarter } from "./starter.js";
import { makeValidate, InvalidUploadError } from "./validate.js";
import { makeSave } from "./save.js";
import { makeFail } from "./fail.js";
import type { Post } from "../posts/repo.js";

const s3Event = (key: string) => JSON.stringify({
  Records: [{ eventName: "ObjectCreated:Put", s3: { bucket: { name: "up" }, object: { key, size: 10 } } }],
});
const sqs = (...bodies: string[]): SQSEvent =>
  ({ Records: bodies.map((body, i) => ({ messageId: `m${i}`, body })) }) as unknown as SQSEvent;

describe("starter (SQS → Step Functions)", () => {
  it("starts one execution per upload, named by postId, and skips S3 test events / foreign keys", async () => {
    const started: { name: string; input: unknown }[] = [];
    const starter = makeStarter(async (name, input) => { started.push({ name, input }); });
    const r = await starter(sqs(s3Event("uploads/u1/p1"), JSON.stringify({ Event: "s3:TestEvent" }), s3Event("media/p1/thumb.jpg")));
    expect(started).toEqual([{ name: "p1", input: { bucket: "up", key: "uploads/u1/p1", userId: "u1", postId: "p1" } }]);
    expect(r).toEqual({ batchItemFailures: [] });
  });

  it("decodes URL-encoded keys from S3 events", async () => {
    const started: string[] = [];
    await makeStarter(async (name) => { started.push(name); })(sqs(s3Event("uploads/u%2D1/p-2")));
    expect(started).toEqual(["p-2"]);
  });

  it("treats ExecutionAlreadyExists as done (redelivered message) and reports real failures per message", async () => {
    const starter = makeStarter(async (name) => {
      if (name === "dup") throw Object.assign(new Error("exists"), { name: "ExecutionAlreadyExists" });
      if (name === "boom") throw new Error("sfn down");
    });
    const r = await starter(sqs(s3Event("uploads/u1/dup"), s3Event("uploads/u1/boom")));
    expect(r).toEqual({ batchItemFailures: [{ itemIdentifier: "m1" }] });
  });
});

describe("validate step", () => {
  const post = (o: Partial<Post> = {}): Post => ({
    postId: "p1", userId: "u1", caption: "", contentType: "image/png", status: "PENDING", createdAt: "t",
    likeCount: 0, commentCount: 0, ...o,
  });
  const input = { bucket: "up", key: "uploads/u1/p1", userId: "u1", postId: "p1" };
  const v = (p: Post | null, head = { contentType: "image/png", size: 100 }) =>
    makeValidate({ getPost: async () => p, head: async () => head });

  it("passes a PENDING post owned by the key's user", async () => {
    expect(await v(post())(input)).toEqual({ ...input, contentType: "image/png", size: 100 });
  });

  it("rejects missing / foreign / non-PENDING posts and bad uploads", async () => {
    await expect(v(null)(input)).rejects.toBeInstanceOf(InvalidUploadError);
    await expect(v(post({ userId: "u2" }))(input)).rejects.toThrow(/owner/);
    await expect(v(post({ status: "READY" }))(input)).rejects.toThrow(/not PENDING/);
    await expect(v(post(), { contentType: "text/plain", size: 5 })(input)).rejects.toThrow(/unsupported/);
    await expect(v(post(), { contentType: "image/png", size: 6e6 })(input)).rejects.toThrow(/too big/);
  });
});

describe("save + fail steps", () => {
  it("save reports alreadyDone when the post was already READY (retry)", async () => {
    const save = makeSave(async () => false);
    const media = { thumb: "t", full: "f", width: 1, height: 1 };
    expect(await save({ postId: "p1", media })).toEqual({ postId: "p1", media, alreadyDone: true });
  });

  it("fail marks the post FAILED with the error cause", async () => {
    const calls: [string, string][] = [];
    const fail = makeFail(async (id, reason) => { calls.push([id, reason]); return true; });
    await fail({ postId: "p1", error: { Error: "InvalidUploadError", Cause: '{"errorMessage":"too big"}' } });
    expect(calls).toEqual([["p1", "InvalidUploadError: too big"]]);
  });
});
