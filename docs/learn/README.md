# Study list

Read in order. Each step: skim the doc, run the "Poke it" commands, then read the code it points to.
Tick boxes as you go. Big picture first: [architecture.md](architecture.md) (every AWS resource, 4 diagrams).

## Step 1: Skeleton (IaC, Lambda, API Gateway, DynamoDB)
- [ ] [01-skeleton.md](01-skeleton.md): what CDK is, how a request reaches a Lambda
- [ ] [system-design-notes.md §2](system-design-notes.md#2-environments--infrastructure-as-code): environments + IaC
- [ ] Code: `infra/lib/core-stack.ts`, `infra/lib/config.ts` (the safety guard)
- [ ] [floci-compat.md](floci-compat.md): what works locally and the gotchas (share with your team)

## Step 2: Login + profiles (Cognito, JWT, DynamoDB transactions)
- [ ] [02-auth-profile.md](02-auth-profile.md): sign-up → token → API flow
- [ ] [system-design-notes.md §3](system-design-notes.md#3-authentication-at-scale-jwts): JWT vs sessions
- [ ] [system-design-notes.md §4](system-design-notes.md#4-data-modelling-in-dynamodb-single-table): single-table design
- [ ] Code: `services/src/users/repo.ts` (the transaction), `web/lib/auth.ts`
- [ ] Try: decode your token at jwt.io and find `sub`, `iss`, `aud`, `exp`

## Step 3: Photo uploads (S3, SQS, Step Functions, EventBridge)
- [ ] [03-upload-pipeline.md](03-upload-pipeline.md): presigned upload → queue → workflow
- [ ] [system-design-notes.md §5](system-design-notes.md#5-file-uploads-at-scale): uploads at scale
- [ ] [system-design-notes.md §6](system-design-notes.md#6-queues-workflows-and-failure-handling): queues, retries, idempotency
- [ ] Code: `infra/lib/pipeline.ts` (the whole pipeline in one file), `services/src/pipeline/*`
- [ ] Try: upload a photo, then look at the Step Functions execution history (commands in the doc)

## Step 4: Follow + feed (EventBridge, hybrid fan-out, Secrets Manager)
- [ ] [system-design-notes.md §1](system-design-notes.md#1-news-feed-how-do-you-build-the-home-feed): **news feed fan-out** (read this first)
- [ ] [04-follow-feed.md](04-follow-feed.md): what got built and how big companies scale it
- [ ] [system-design-notes.md §7](system-design-notes.md#7-pagination-and-event-driven-design): cursor pagination + event-driven design
- [ ] Code: `services/src/feed/fanout.ts` (push), `services/src/feed/handler.ts` + `merge.ts` (pull + merge)
- [ ] Try: `npm run seed`, log in as bob, unfollow alice, watch her posts vanish

## Step 5: Likes, comments, notifications (DynamoDB Streams, SNS)
- [ ] [05-likes-comments-notifs.md](05-likes-comments-notifs.md): dual-write problem → CDC
- [ ] [system-design-notes.md §8](system-design-notes.md#8-keeping-data-and-events-consistent-outbox--cdc--counters-at-scale): outbox / CDC + counters at scale
- [ ] Code: `services/src/events/map.ts` (the whole CDC idea in 20 lines), `services/src/notify/worker.ts`
- [ ] Try: like a post as bob, then log in as its author and open Activity

## Step 6: Ops (logs, alarms, DLQs, redrive)
- [ ] [06-ops.md](06-ops.md): do the "break it on purpose" exercise
- [ ] [system-design-notes.md §9](system-design-notes.md#9-observability-and-reliability): observability + reliability
- [ ] Code: `infra/lib/ops.ts` (alarms), `scripts/src/ops.ts` (the ops CLI), `services/src/lib/log.ts`
- [ ] Re-read notes §1: the two feed details added after the code review (pagination floor, celeb registry)

## Step 7: Hosting (S3 + CloudFront, cache headers, OAC, Next.js SSR options)
- [ ] [07-cdn-hosting.md](07-cdn-hosting.md): CDN, cache headers, and how companies run Next.js SSR on AWS
- [ ] Code: `infra/lib/web.ts`, `scripts/src/web-plan.ts` (cache headers per file)
- [ ] Try: `npm run deploy:web`, open the printed URL, log in as bob

## Step 8: real AWS (next, together)
- [ ] [08-real-aws-checklist.md](08-real-aws-checklist.md): account, MFA, **$5 budget first**, SSO login

## Every step has a "How big companies do it" table at the end. Read those for interview follow-ups.
