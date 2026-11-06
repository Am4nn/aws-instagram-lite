# Step 4: Follow + News Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users follow each other; a home feed shows posts from people you follow, built with **hybrid fan-out** (push for normal authors, pull for celebs, threshold 3 locally), paginated with HMAC-signed cursors whose key lives in Secrets Manager. A seed script creates demo users so the feed is visible immediately.

**Architecture:** `social` Lambda: follow/unfollow = one DynamoDB transaction (edge items both directions + both counters) and emits `UserFollowed` to EventBridge. EventBridge rules route `PostPublished` and `UserFollowed` into a `fanout` SQS queue (+DLQ) → `fanout` Lambda writes `FEED#<follower>` items (skips celeb authors; backfills the last 10 posts on follow). `feed` Lambda: reads own feed items + recent posts of followed celebs, drops authors no longer followed, merges newest-first, hydrates posts + authors, signs the cursor.

**Tech Stack:** previous + `@aws-sdk/client-secrets-manager` 3.1163.

**Spec:** `docs/superpowers/specs/2026-11-06-instagram-lite-design.md` (feed section).

## Global Constraints

- Keys: following `USER#<me> / FOLLOWS#<other>`; follower `USER#<other> / FOLLOWER#<me>`; feed `FEED#<userId> / <createdAt>#<postId>` with `postId, authorId`, `ttl` = 30 days.
- Celeb = `followerCount >= CELEB_THRESHOLD` (3 local, 10000 aws) evaluated at fan-out time and at read time.
- Feed page size 10. Cursor = `base64url(JSON{before}) + "." + base64url(HMAC-SHA256)`; bad cursor → 400.
- Events: source `ig.social`, detail-type `UserFollowed`, detail `{ followerId, followeeId }`; existing `ig.posts`/`PostPublished` `{ postId, userId }`.
- Follow is idempotent (already following → 200, no count change); unfollow when not following → 200; self-follow → 400; unknown user → 404.
- Learn docs: `04-follow-feed.md`, expand notes §1 with what was built, notes §7 (event-driven choreography + pagination), study list.

## Review Focus

1. **Double follow / double unfollow** → counters never drift. → int test (Task 1).
2. **Unfollow** → that author's posts disappear from the feed immediately (read-time filter), even though feed items remain. → smoke (Task 6).
3. **Author becomes celeb after some fan-out** → no duplicates in the merged page (dedupe by postId). → unit test (Task 3).
4. **Tampered / garbage cursor** → 400, not 500. → unit test (Task 3).
5. **Event redelivery** → fan-out writes are idempotent (same key overwrite). → unit test (Task 2).

---

### Task 1: Follows repo + social handler
`services/src/social/repo.ts` `makeFollowsRepo(doc, table)`: `follow(me, other): Promise<boolean>` (false if already), `unfollow(me, other): Promise<boolean>`, `isFollowing(me, other)`, `listFollowing(me, limit=1000): Promise<string[]>`, `listFollowers(userId): AsyncIterable<string[]>` (pages).
`services/src/social/handler.ts` `makeHandler({ follows, userExists, publish })`: `POST|DELETE /users/{userId}/follow`.
- [ ] Int tests: follow → both counts +1 and edges exist; second follow → false, counts unchanged; unfollow → counts back; second unfollow → false; listFollowing/listFollowers.
- [ ] Handler unit tests: 200 `{ following: true|false }`, self → 400, unknown → 404, publishes `UserFollowed` only when a new edge was created.
- [ ] `GET /users/{username}` adds `isFollowing` (users handler gets an optional `isFollowing(me, other)` dep; unit test).

### Task 2: Fan-out Lambda
`services/src/feed/fanout.ts` `makeFanout({ getProfile, followers, recentPosts, writeFeed, threshold })` handling an SQS batch of EventBridge events.
- [ ] Unit tests: normal author → feed items for every follower + the author; celeb → only the author's own feed; `UserFollowed` (non-celeb followee) → last 10 posts copied to follower; celeb followee → nothing; unknown detail-type ignored; failures reported per message.
- [ ] `writeFeed` = BatchWrite in chunks of 25, retrying `UnprocessedItems`.

### Task 3: Feed merge + cursor (pure) and feed handler
`services/src/feed/cursor.ts`: `signCursor(before, key)`, `verifyCursor(token, key): string | null`.
`services/src/feed/merge.ts`: `mergeFeed({ feedItems, celebPosts, following, me, limit }): { items: Ref[]; next?: string }` (Ref = `{ postId, authorId, sortKey }`).
`services/src/feed/handler.ts`: `GET /feed?cursor=` → `{ items: (Post & { author: { userId, username } , thumbUrl, fullUrl })[], next?: string }`.
- [ ] Unit tests: sign/verify round-trip, tamper → null, garbage → null; merge sorts newest first, dedupes postIds, drops unfollowed authors (keeps own), honours limit, `next` = last sortKey only when more remain.
- [ ] Handler unit tests with fakes: bad cursor → 400; returns hydrated items.

### Task 4: Infra
- [ ] Template tests: secret `<prefix>-cursor-key`; fanout queue + DLQ; EventBridge rule(s) for PostPublished + UserFollowed targeting the queue; functions `social`, `fanout`, `feed` (feed has `CELEB_THRESHOLD`, `CURSOR_SECRET_ARN`); routes `POST/DELETE /users/{userId}/follow`, `GET /feed` (JWT).
- [ ] Implement `infra/lib/social.ts`; deploy:local.

### Task 5: Web
- [ ] `/feed` page (default landing after login; nav "Home"): cards (author link, full image, caption, time), "Load more" with cursor, empty state with a "find people" box (go to `/u?name=`). Follow/Unfollow button on `/u` (hidden on yourself) updating follower count. Build passes.

### Task 6: Seed + smoke + docs
- [ ] `scripts/src/seed.ts` (`npm run seed`): users `alice, bob, carol, dave, eve, star` (password `password1`), everyone except eve follows star (star → celeb with 4 followers ≥ 3); bob follows alice and carol; each user posts 2 coloured images; waits for READY. Idempotent (re-run signs in instead).
- [ ] Smoke `feed` section: as bob, feed has alice's + carol's (push) + star's (pull) posts, none of eve's; page 2 via cursor has no overlap; tampered cursor → 400; bob unfollows alice → alice's posts gone; re-follow → back (backfill).
- [ ] Docs + study list; full suite; merge.
