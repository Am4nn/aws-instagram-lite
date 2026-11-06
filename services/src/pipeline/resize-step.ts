import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { mediaKeys } from "../posts/keys.js";
import { resizeImage } from "../posts/resize.js";
import { InvalidUploadError } from "./validate.js";
import type { PipelineInput } from "./starter.js";

const s3 = new S3Client({ forcePathStyle: true });

/** Original (uploads bucket) → thumb + full JPEGs (media bucket). */
export async function handler(input: PipelineInput) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
  const bytes = Buffer.from(await obj.Body!.transformToByteArray());
  let out: Awaited<ReturnType<typeof resizeImage>>;
  try {
    out = await resizeImage(bytes);
  } catch (e) {
    throw new InvalidUploadError(`not a readable image: ${(e as Error).message}`);
  }
  const keys = mediaKeys(input.postId);
  const put = (Key: string, Body: Buffer) =>
    s3.send(new PutObjectCommand({
      Bucket: process.env.MEDIA_BUCKET, Key, Body, ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable", // file names never change: cache forever
    }));
  await Promise.all([put(keys.thumb, out.thumb), put(keys.full, out.full)]);
  return { ...input, media: { ...keys, width: out.width, height: out.height } };
}
