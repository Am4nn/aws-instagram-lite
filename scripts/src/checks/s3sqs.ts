import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { check, assert, waitForMessage, type Outputs } from "./util.js";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64",
);

export async function run(o: Outputs) {
  const s3 = new S3Client({ forcePathStyle: true });
  const key = `spike/${Date.now()}.png`;
  return [
    await check("S3", "Presigned PUT upload from a client (fetch)", async () => {
      const url = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: o.UploadBucket, Key: key, ContentType: "image/png",
      }), { expiresIn: 300 });
      const res = await fetch(url, { method: "PUT", body: PNG, headers: { "content-type": "image/png" } });
      assert(res.ok, `PUT status ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return `path-style URL on ${new URL(url).host}`;
    }),
    await check("S3 → SQS", "ObjectCreated:* notification lands on SQS", async () => {
      await waitForMessage(o.UploadQueueUrl, (b) => b.includes(key));
      return "event names the uploaded key";
    }),
  ];
}
