import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { docClient, tableName } from "../lib/db.js";
import { makePostsRepo, type Post } from "../posts/repo.js";
import { checkUpload } from "../posts/validate.js";
import { imageSize } from "../posts/image-size.js";

export const MAX_MEGAPIXELS = 40;
import type { PipelineInput } from "./starter.js";

/** Thrown for bad uploads; the state machine catches it and marks the post FAILED (no retries). */
export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

type Deps = {
  getPost: (postId: string) => Promise<Post | null>;
  head: (bucket: string, key: string) => Promise<{ contentType?: string; size?: number }>;
  /** First ~64 KB of the object (enough for PNG/JPEG headers). */
  readHeader: (bucket: string, key: string) => Promise<Buffer>;
};

export function makeValidate(d: Deps) {
  return async (input: PipelineInput) => {
    const post = await d.getPost(input.postId);
    if (!post) throw new InvalidUploadError("no such post");
    if (post.userId !== input.userId) throw new InvalidUploadError("upload key owner does not match post owner");
    if (post.status !== "PENDING") throw new InvalidUploadError(`post is ${post.status}, not PENDING`);
    const head = await d.head(input.bucket, input.key);
    const check = checkUpload(head);
    if (!check.ok) throw new InvalidUploadError(check.reason);
    const dims = imageSize(await d.readHeader(input.bucket, input.key));
    if (dims && dims.width * dims.height > MAX_MEGAPIXELS * 1e6) {
      throw new InvalidUploadError(`${dims.width}x${dims.height} is over ${MAX_MEGAPIXELS} megapixels`);
    }
    // dims === null: not a PNG/JPEG header → Resize will reject it as unreadable.
    return { ...input, contentType: head.contentType, size: head.size };
  };
}

const s3 = new S3Client({ forcePathStyle: true });
export const handler = makeValidate({
  getPost: (id) => makePostsRepo(docClient(), tableName()).get(id),
  head: async (Bucket, Key) => {
    const h = await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return { contentType: h.ContentType, size: h.ContentLength };
  },
  readHeader: async (Bucket, Key) => {
    const o = await s3.send(new GetObjectCommand({ Bucket, Key, Range: "bytes=0-65535" }));
    return Buffer.from(await o.Body!.transformToByteArray());
  },
});
