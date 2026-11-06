# Step 5: Likes, Comments, Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Like/unlike and comment on READY posts with exact counters; every like, comment and follow notifies the recipient in-app (and is published to SNS). Domain events come from **change data capture** (DynamoDB Streams), not dual writes.

**Architecture:** `engage` Lambda writes like/comment items + counters in transactions. The table stream (NEW_IMAGE, INSERT-only filter) feeds an `events` Lambda that maps new `LIKE#` / `COMMENT#` / `FOLLOWER#` items to `PostLiked` / `PostCommented` / `UserFollowed` on the bus (the social handler stops publishing directly). An EventBridge rule routes those three into a `notify` SQS queue (+DLQ) → `notify` Lambda writes `NOTIF#<recipient>` items and publishes to an SNS topic. `notifications` routes list them and mark all read via a `lastReadAt` marker.

**Tech Stack:** previous + `@aws-sdk/client-sns` 3.1163, `aws-lambda` DynamoDBStreamEvent types, `@aws-sdk/util-dynamodb` (unmarshall).

**Spec:** `docs/superpowers/specs/2026-11-06-instagram-lite-design.md`

## Global Constraints

- Keys: like `POST#<id> / LIKE#<userId>` `{ userId, postAuthorId, createdAt }`; comment `POST#<id> / COMMENT#<createdAt>#<commentId>` `{ commentId, userId, username, text, postAuthorId, createdAt }`; notification `NOTIF#<recipient> / <createdAt>#<id>` `{ type, actorId, actorUsername, postId?, text?, ttl 90 days }`; read marker `USER#<id> / NOTIFSTATE` `{ lastReadAt }`.
- Only READY posts can be liked/commented (else 404). Comment text 1-500 chars (trimmed).
- Like/unlike idempotent (like twice = one like). Counters change only with the item (same transaction).
- No self-notifications (liking/commenting your own post).
- Events: source `ig.engage` for `PostLiked {postId, authorId, actorId}` and `PostCommented {postId, authorId, actorId, commentId, text}`; source `ig.social` for `UserFollowed {followerId, followeeId}` (same shape as step 4, now emitted by CDC).
- Learn docs: `05-likes-comments-notifs.md` (+ "How big companies do it"), notes §8 (CDC/outbox + counters at scale), study list.

## Review Focus

1. **Double like / double unlike** → likeCount exact. → int test (Task 1).
2. **Like then unlike then like** → one notification per *new* like? (each INSERT emits; acceptable, documented) → unit test documents behaviour (Task 3).
3. **Self-like / own comment** → no notification. → unit test (Task 4).
4. **Comment on a PENDING/FAILED/unknown post** → 404. → handler test (Task 2).
5. **Stream redelivery** → notification write idempotent (id derived from the source item key). → unit test (Task 4).

---

### Task 1: Engage repo (likes + comments), integration tests on Floci
`services/src/engage/repo.ts` `makeEngageRepo(doc, table)`: `like(post, userId): Promise<boolean>`, `unlike(postId, userId): Promise<boolean>`, `likedBy(postIds, userId): Promise<Set<string>>`, `addComment(post, user: {userId, username}, text): Promise<Comment>`, `listComments(postId, after?, limit=20): Promise<{ items: Comment[]; next?: string }>`.

### Task 2: Engage handler + `likedByMe`
`POST|DELETE /posts/{id}/like` → `{ liked, likeCount }`; `GET|POST /posts/{id}/comments`. `GET /posts/{id}` and feed items gain `likedByMe`.

### Task 3: CDC: stream → events Lambda; social stops publishing
`services/src/events/map.ts` `toDomainEvent(newImage): { source, detailType, detail } | null` (pure); `services/src/events/publisher.ts` (stream batch → PutEvents, per-record failures).

### Task 4: Notifications
`services/src/notify/repo.ts` (put with deterministic id, list, unread count, markAllRead) + int tests; `services/src/notify/worker.ts` `makeNotify(...)` (SQS batch of bus events → skip self → actor username → NOTIF item → SNS publish); `services/src/notify/handler.ts` (`GET /notifications`, `POST /notifications/read`).

### Task 5: Infra
Table stream; `engage`, `events` (stream source, INSERT filter), `notify` (SQS), `notifications` functions; notify queue + DLQ; rule for the three detail-types; SNS topic `<prefix>-notifications`; routes. Template tests first.

### Task 6: Web
Like button (♡/♥ + count) on feed cards and post page; comments list + box on post page; `/notifications` page; unread badge in nav.

### Task 7: Smoke + docs; merge.
Smoke `engage`: carol likes + comments on alice's post → counts, likedByMe; alice gets 2 notifications (+ follow notifications from seed), unread count, mark read → 0; carol liking her own post → no notification; double like → count 1.
