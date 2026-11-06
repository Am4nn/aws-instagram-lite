# Study list

Read in order. Each step: skim the doc, run the "Poke it" commands, then read the code it points to.
Tick boxes as you go.

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

## Big system design topics (come back after step 4)
- [ ] [system-design-notes.md §1](system-design-notes.md#1-news-feed-how-do-you-build-the-home-feed): news feed fan-out
