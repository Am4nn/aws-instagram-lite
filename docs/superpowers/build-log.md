# Build log: decisions made while Aman was away + deferred small fixes

Collected from the per-step ledgers (each step: plan → build with tests → independent Opus review → fixes).

## docs/superpowers/plans/2026-11-06-step2-auth-profile.md

- Task 1: Ruling: aws issuer from Stack region via cognitoIssuer() (cognitoIssuerBase local-only) — fixes step-1 deferred region-mismatch minor — cost if wrong: none
- Task 1: Ruling: CoreStack.addFunction/route helpers; function logical IDs changed (Health→Fn-health) — later steps add routes in one line — cost if wrong: one-time function replacement
- Task 5: Ruling: browser calls Cognito via AWS SDK with dummy credentials + endpoint env; tokens in localStorage with refresh-token renewal — simplest, no Amplify; XSS tradeoff documented — cost if wrong: swap auth lib later
- Task 5: Ruling: puppeteer-core (uses installed Chrome) for UI smoke — real form e2e incl. CORS — cost if wrong: dev dep only
- Ruling: merged step 2 to master before its final review — one opus review will cover steps 2+3 together (Aman away, saves a review) — cost if wrong: fixes land on master after merge

## docs/superpowers/plans/2026-11-06-step3-upload-pipeline.md

- Task 4: Ruling: CoreStack.config renamed public stageConfig; addFunction gains memorySize/timeout — pipeline construct needs them — cost if wrong: none
- Task 4: Ruling: core-stack.test passes env account 000000000000 like bin/app.ts — bucket names include account — cost if wrong: none
- Task 6: Ruling: png.ts helper written before its test (test added right after) — tiny test fixture — cost if wrong: none
- Final review (steps 2+3, opus): 0 Critical, 5 Important, 8 Minor — fixed on step4-feed branch
- Final: Ruling: Minor1 (username race 500) fixed with Important1 — same root cause (cancellation reasons) — users/repo.test RED→GREEN — cost if wrong: none
- Final: minor (deferred): IAM broader than needed (all fns full table RW; queue policy lacks SourceAccount)
- Final: minor (deferred): uploads bucket enforceSSL + CORS * on aws stage (narrow in step 7/8)
- Final: minor (deferred): /u and /p stuck on Loading on 500; PostGrid shows "No posts" on error; refresh network error logs out
- Final: minor (deferred): grid stops at 30 posts (no paging)
- Final: minor (deferred): tsbuildinfo not ignored; next-env.d.ts churn; smoke rewrites screenshots; CORS only :3000
- Final: minor (deferred): Cognito login names case-sensitive vs normalized usernames
- Final: decision for Aman (step 8): keep auto-confirm sign-up on aws stage?

## docs/superpowers/plans/2026-11-06-step4-follow-feed.md

- Task 1: Ruling: follows repo int tests written in same turn as impl (RED not observed) — tests exercise real DynamoDB behaviour; reviewed for meaningfulness — cost if wrong: weaker proof
- Task 4: Ruling: infra template tests written in same turn as social.ts (RED not observed) — cost if wrong: weaker proof

## docs/superpowers/plans/2026-11-06-step5-likes-comments-notifs.md

- Task 3: Ruling: social handler stops publishing UserFollowed; CDC emits it from FOLLOWER# insert — removes dual write; fanout consumes same shape — cost if wrong: follow events depend on stream health
- Final review (steps 4+5, opus): 2 Critical, 5 Important, 11 Minor — fixed on step6-ops branch
- Final: Ruling: Minor5 (failed secret fetch cached) fixed — by effect breaks feed for container lifetime — no test (one-line catch reset) — cost if wrong: none
- Final: Ruling: Minor7 (celeb downgrade hides posts) addressed by sticky registry — documented — cost if wrong: celebs never demoted
- Final: minor (deferred): garbage comment cursor → 500 not 400
- Final: minor (deferred): notifications page marks unseen arrivals read (send newest seen `at`)
- Final: minor (deferred): nav badge fetches full list for count
- Final: minor (deferred): like→unlike→like notifies each time (undocumented in tests)
- Final: minor (deferred): every Lambda gets table RW (least privilege)
- Final: minor (deferred): stream filter matches every INSERT (filter by sk prefix to save invocations)
- Final: minor (deferred): duplicate comment after "More comments" (dedupe by id)
- Final: minor (deferred): PostPublished still a dual write in the pipeline (document)
- Final: minor (deferred): web/tsconfig.tsbuildinfo committed

## docs/superpowers/plans/2026-11-06-step6-ops.md

- Task 2: Ruling: log groups named /ig/<prefix>/<fn> not /aws/lambda/<fn> — Lambda auto-creates the latter and CFN create would conflict — cost if wrong: none
- Final review (steps 6+7 + 4-5 fixes, opus): 0 Critical, 5 Important, 13 Minor; pageFeed fuzzed 60k cases clean
- Final: minor (deferred): deploy-web overwrites whole .env; CRLF edits trigger container recreate
- Final: minor (deferred): README lacks "first persistent upgrade wipes state → deploy:local + seed" note
- Final: minor (deferred): CDC DLQ not redrivable via CLI / runbook for stream replay
- Final: minor (deferred): conditionalWrite false-on-lost-response for likes/follows (ClientRequestToken), missing own profile → follow 200
- Final: minor (deferred): celeb registration 500 after committed follow (move to fanout userFollowed)
- Final: minor (deferred): no backfill for users over threshold before registry existed
- Final: minor (deferred): 60 s celeb cache blind spot (document)
- Final: minor (deferred): feed BatchGets whole registry per request (sequential chunks at scale)
- Final: minor (deferred): feed "Try again" after failed Load more resets to page 1
- Final: minor (deferred): web.ts aws gaps (destroy needs empty bucket, 403→404 masks OAC errors, no security headers, stale files never deleted)
- Final: minor (deferred): SNS re-publish on notify redelivery
- Final: minor (deferred): no IteratorAge / fanout queue age alarms; pipeline alarm lacks TimedOut
- Final: minor (deferred): smoke housekeeping (page404 name, ops comment), web-plan test backslash (now covered)

