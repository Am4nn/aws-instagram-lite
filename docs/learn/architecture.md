# Architecture: everything in the `ig-<stage>-core` stack

Drawn from `infra/lib/*.ts` (one CDK stack). Same diagram for Floci and real AWS; only endpoints differ.
17 Lambdas on Floci, 16 on AWS (the presignup trigger is local-only; both stages have the `web-server` Lambda
from step 9), 1 DynamoDB table, 3 S3 buckets, 1 CloudFront distribution (+ 1 CloudFront Function),
1 state machine, 1 event bus, 7 SQS queues, 2 SNS topics, 6 alarms.

## 1. Request path (browser → CloudFront → Next.js server → API → table)

Since step 9 the browser only talks to one domain. The Next.js server (the BFF) calls the API for it.

```mermaid
flowchart LR
  B([Browser]) -->|https, cookies| CF[CloudFront]
  CF -->|/_next/static/*, OAC| WEB[(S3 web)]
  CF -->|/media/*, OAC| MEDIA[(S3 media)]
  CF -->|"everything else + x-origin-verify"| SSR[λ web-server<br/>Next.js / OpenNext<br/>Function URL]
  SSR -->|sign in, refresh| COG[Cognito user pool]
  COG -.->|PreSignUp, local only| PSU[λ presignup]
  SSR -->|Bearer JWT from the ig_id cookie| API[HTTP API]
  API -->|JWT authorizer checks token| COG
  API --> USERS[λ users] & POSTS[λ posts] & SOCIAL[λ social] & FEED[λ feed] & ENGAGE[λ engage] & NOTIFS[λ notifications]
  API -->|public| HEALTH[λ health]
  USERS & POSTS & SOCIAL & FEED & ENGAGE & NOTIFS --> DDB[(DynamoDB ig-*-main)]
  FEED -->|cursor HMAC key| SM[Secrets Manager]
  B -.->|presigned PUT, photo bytes| UP[(S3 uploads)]
```

## 2. Upload pipeline

```mermaid
flowchart LR
  B([Browser]) -->|1. POST /posts| POSTS[λ posts] -->|presigned PUT URL| B
  B -->|2. PUT photo| UP[(S3 uploads)] -->|ObjectCreated| Q[SQS uploads] --> ST[λ starter]
  Q -.->|after 3 tries| DLQ1[SQS uploads-dlq]
  ST -->|StartExecution name=postId| SF
  subgraph SF[Step Functions pipeline]
    V[Validate] --> R[Resize] --> S[Save → READY] --> P[Publish]
    V & R & S -.->|catch| F[MarkFailed] --> C{user error?}
    C -->|yes| REJ[Rejected ✓]
    C -->|no| FAIL[Failed ✗]
  end
  R --> MEDIA[(S3 media)]
  S --> DDB[(DynamoDB)]
  P -->|PostPublished| BUS[EventBridge bus]
```

## 3. Events: fan-out, CDC, notifications

```mermaid
flowchart LR
  DDB[(DynamoDB)] -->|Stream: INSERTs| EV[λ events]
  EV -->|PostLiked / PostCommented / UserFollowed| BUS[EventBridge bus]
  EV -.->|on failure| CDCDLQ[SQS cdc-dlq]
  SFN[Step Functions] -->|PostPublished| BUS
  BUS -->|FanoutRule: PostPublished, UserFollowed| QF[SQS fanout] --> FO[λ fanout] -->|FEED# items| DDB
  BUS -->|NotifyRule: Liked, Commented, Followed| QN[SQS notify] --> NO[λ notify] -->|NOTIF# items| DDB
  NO --> TOPIC[SNS notifications]
  QF -.-> DLQF[SQS fanout-dlq]
  QN -.-> DLQN[SQS notify-dlq]
```

## 4. Ops

```mermaid
flowchart LR
  DLQS[4 DLQs: uploads, fanout, notify, cdc] -->|messages > 0| AL[CloudWatch alarms]
  SFN[Pipeline failed executions] --> AL
  API[HTTP API 5xx] --> AL
  AL --> OPS[SNS ops] -->|local only| INBOX[SQS ops-inbox]
  L[All 17 λ, 16 on AWS] -->|logs| CWL[CloudWatch Logs /ig/prefix/fn, 14 days]
```
