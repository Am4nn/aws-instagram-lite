# Step 3: Photo Upload Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user creates a post, uploads a photo straight to S3 with a presigned URL, and an event-driven pipeline (S3 → SQS → starter Lambda → Step Functions: validate → resize → save → publish) turns it into a READY post shown on their profile grid.

**Architecture:** `POST /posts` writes a `PENDING` post item and returns a presigned PUT URL for `uploads/<userId>/<postId>`. The uploads bucket (L1 `CfnBucket`, native notification) sends `ObjectCreated:*` to an SQS queue (DLQ after 3 tries). A starter Lambda turns each message into a Step Functions execution. Steps are small Lambdas; failures are caught and mark the post `FAILED`. Save sets the sparse GSI1 keys (only READY posts appear in profile grids) and bumps `postCount`. Publish emits `PostPublished` on the custom EventBridge bus (consumed in step 4). Media is served via presigned GET URLs for now (CloudFront in step 7).

**Tech Stack:** step 2 stack + `jimp` 1.6 (pure-JS resize), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sfn`, `@aws-sdk/client-eventbridge` 3.1163.

**Spec:** `docs/superpowers/specs/2026-11-06-instagram-lite-design.md`

## Global Constraints

- All earlier constraints (stages, prefixes, no custom resources, nodejs22.x, serverless, local commits).
- Bucket names must be globally unique on AWS: `<prefix>-uploads-<account>`, `<prefix>-media-<account>`.
- Upload key: `uploads/<userId>/<postId>`; media keys: `media/<postId>/thumb.jpg` (320 px wide max) and `media/<postId>/full.jpg` (1080 px max), JPEG quality 80.
- Allowed types: `image/jpeg`, `image/png`, `image/webp`; max 5 MB; caption ≤ 2200 chars (Instagram's limit).
- Post item: `pk=POST#<id>, sk=POST`, `status PENDING|READY|FAILED`; when READY also `gsi1pk=USER#<userId>, gsi1sk=POST#<createdAt>#<id>`.
- Floci quirk: Lambda SDK endpoint is `http://localhost.floci.io:4566`; presigned URLs made inside Lambda resolve from the browser too (public DNS → 127.0.0.1).
- Step Functions on Floci: use Lambda tasks + optimized EventBridge `events:putEvents`; no `aws-sdk:*` integrations.
- Learn docs: `docs/learn/03-upload-pipeline.md`, notes §5 (presigned uploads) + §6 (queues, workflows, retries/DLQ), study list.

## Review Focus

1. **Non-image or oversized upload** → post ends `FAILED` (never stuck `PENDING`), not shown in grid. → smoke test FAILED path (Task 6).
2. **Duplicate S3 event / SQS redelivery** → no double `postCount` increment. → save step uses a condition `status = PENDING`; unit-tested in Task 3.
3. **Someone uploads to another user's key** → can't: the presigned URL is minted by the API for the caller's own `userId/postId`; validate step checks the post exists, belongs to the key's user and is PENDING. → Task 3 test.
4. **Upload never happens** (user closes tab) → post stays PENDING and invisible (sparse index). Noted as known gap: TTL cleanup later. → Task 2 sets `ttl` = now + 1 day on PENDING; save removes it.
5. **Big images and Lambda memory/time** → resize Lambda 1024 MB / 30 s; validate rejects > 5 MB before resize. → config in Task 4.

---

### Task 1: Pure helpers (keys, validation, resize)
`services/src/posts/keys.ts`: `uploadKey(userId, postId)`, `parseUploadKey(key): { userId; postId } | null`, `mediaKeys(postId)`.
`services/src/posts/validate.ts`: `validateCreatePost(body)` → `{ caption, contentType }`; `checkUpload({ contentType, size })` → `{ ok } | { ok:false, reason }`.
`services/src/posts/resize.ts`: `resizeImage(buf): Promise<{ thumb: Buffer; full: Buffer; width; height }>`.
- [ ] Tests first: key round-trip + rejects other prefixes / path traversal (`uploads/a/../b`); caption limits; type/size rules; resize of a generated 2000×1000 PNG → thumb width 320, full width 1080, both JPEG (magic bytes `FF D8`); small 200×100 image is not upscaled.

### Task 2: Posts repo + API (`POST /posts`, `GET /posts/{id}`, `GET /users/{userId}/posts`)
`services/src/posts/repo.ts` `makePostsRepo(doc, table)`: `createPending(userId, input)`, `get(postId)`, `listByUser(userId, limit=30)` (GSI1, newest first), `markReady(postId, media)` (condition `status = PENDING`, sets gsi keys, removes ttl, `ADD postCount :1` on profile in the same transaction; returns false if not PENDING), `markFailed(postId, reason)` (condition PENDING).
`services/src/posts/handler.ts` `makeHandler({ repo, presignPut, presignGet })`.
- [ ] Integration tests (Floci DynamoDB): create → get PENDING; listByUser excludes PENDING; markReady → listed, profile postCount +1; markReady twice → second returns false and count still +1; markFailed on READY → false.
- [ ] Handler unit tests (fakes): POST → 201 `{ postId, uploadUrl, key }`, 400 bad type/caption, 404 no profile yet; GET post → media URLs only when READY; GET user posts → array.

### Task 3: Pipeline step handlers
`services/src/pipeline/starter.ts` (SQS batch → `StartExecution`, `name = postId` for idempotency, ignore `s3:TestEvent`, report `batchItemFailures`), `validate.ts` (HeadObject + post checks), `resizeStep.ts` (get object → resizeImage → put both), `save.ts` (markReady), `fail.ts` (markFailed with error cause). Each exports `makeX(deps)` for tests.
- [ ] Unit tests with fakes: starter maps records to executions, skips test events, duplicate execution name (`ExecutionAlreadyExists`) counts as success; validate rejects wrong owner / non-PENDING / bad type / too big; save returns `{ alreadyDone: true }` when markReady is false.

### Task 4: Infra: buckets, queue, state machine, bus, routes
- [ ] Template tests first: uploads `CfnBucket` with `QueueConfigurations` + CORS; media bucket; queue with DLQ `maxReceiveCount 3`; `AWS::StepFunctions::StateMachine` with `Catch`; event bus `<prefix>-bus`; routes `POST /posts`, `GET /posts/{id}`, `GET /users/{userId}/posts` (JWT); resize fn memory 1024; still no custom resources.
- [ ] Implement in `infra/lib/pipeline.ts` (construct used by CoreStack); deploy:local.

### Task 5: Web: upload page + profile grid
- [ ] `/new` page: pick file (preview), caption, POST /posts → PUT file to uploadUrl → poll GET /posts/{id} every 1.5 s (max 60 s) → done → `/me`. Profile pages show a 3-column grid of thumbs from `GET /users/{userId}/posts`. Nav gets "New post". Build passes.

### Task 6: Smoke + docs
- [ ] Extend smoke: API upload of a generated PNG → READY within 60 s, appears in user posts, profile postCount 1; upload of a text file as image/png → FAILED; UI: upload via `/new` with a generated image file → grid shows 1 thumb; screenshot.
- [ ] `docs/learn/03-upload-pipeline.md`, notes §5-§6, study list; full suite; merge; then the combined steps 2-3 review.
