# Step 1: Skeleton + Floci Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working npm-workspaces repo whose CDK app deploys a DynamoDB table + `/health` Lambda behind an HTTP API to Floci, a Next.js page that shows the health result, and a spike that proves every service later steps need works on Floci (written up as `docs/learn/floci-compat.md`).

**Architecture:** One CDK app (`infra/`) with a `stage` context (`local` → Floci, `aws` → real account). Lambda code lives in `services/`, bundled by local esbuild (no Docker bundling). A separate throwaway `SpikeStack` exercises Cognito, S3→SQS, Step Functions, EventBridge, SNS, Secrets Manager and CloudWatch; a Node script checks each and writes the report.

**Tech Stack:** Node 26 locally / `nodejs22.x` Lambda runtime, TypeScript 5.x (not 7, for tooling compat), aws-cdk-lib 2.275, aws-cdk CLI 2.1148, AWS SDK v3, esbuild 0.28, vitest 5, Next.js 16 (`output: 'export'`), tsx to run TS scripts, Floci 2.4 (CLI 0.4).

**Spec:** `docs/superpowers/specs/2026-11-06-instagram-lite-design.md`

## Global Constraints

- Project root: `C:\Aman\Coding-Bamzii\Web Development\aws\instagram-lite` (path has a **space**; every script must quote paths).
- Two stages only: `local` (Floci, `AWS_ENDPOINT_URL=http://localhost:4566`, keys `test`/`test`, region `us-east-1`) and `aws`.
- Serverless only. No VPC, NAT, RDS, ECS, ALB constructs anywhere.
- No CDK custom resources (`BucketDeployment`, `autoDeleteObjects`, `AwsCustomResource`). `removalPolicy: DESTROY` on stateful resources.
- Lambda runtime `nodejs22.x`; bundle with local esbuild (`NodejsFunction` + `esbuild` devDependency).
- Every resource name / stack name prefixed `ig-<stage>-`.
- Floci JWT flag: `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS=true` must be set on the Floci container for local Cognito JWT authorizers.
- UI: Next.js static export only; calm style, no glow/gradients.
- Git: local commits OK, no remote, no push. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Each step ends with a short chat explainer + `docs/learn/01-skeleton.md` (what, why, mermaid diagram, interview angle, commands to poke it). Stop for Aman's OK afterwards.

## Review Focus

1. **Accidental real-AWS deploy:** `stage=local` without `AWS_ENDPOINT_URL` pointing at localhost must refuse to synth/deploy; `stage=aws` with `AWS_ENDPOINT_URL` set must refuse. → test in Task 2.
2. **Space in project path** breaks esbuild/CDK asset paths or scripts. → Task 3 deploy runs from the real path; scripts quote everything.
3. **Floci/Docker not running:** scripts must fail fast with "Floci not reachable at http://localhost:4566 — run `floci start`" instead of a hung CDK call. → test in Task 1 (`assertFlociUp`).
4. **Redeploy is idempotent:** deploying twice with no changes must succeed (no "already exists"). → Task 3 Step verifies a second deploy.
5. **Floci restart:** after `floci restart` state may vanish; `deploy-local` must recreate everything from scratch (incl. bootstrap). → Task 3 verifies deploy after `floci reset`.

---

## File Structure

```
package.json                 workspaces: infra, services, web, scripts
tsconfig.base.json           strict, ES2022, NodeNext
.gitignore                   node_modules, cdk.out, .next, out, *.log
README.md                    how to run (short)
scripts/
  package.json
  src/env.ts                 floci env + assertFlociUp()
  src/env.test.ts
  src/deploy-local.ts        bootstrap (if needed) + deploy CoreStack to Floci, print outputs
  src/spike-check.ts         runs every spike check, writes docs/learn/floci-compat.md
  src/checks/*.ts            one file per service check
services/
  package.json
  src/http.ts                json(status, body) helper
  src/health.ts              GET /health handler
  src/health.test.ts
infra/
  package.json, cdk.json
  bin/app.ts                 reads -c stage, builds stacks
  lib/config.ts              StageConfig + loadConfig(stage, env)
  lib/config.test.ts
  lib/core-stack.ts          table + health fn + HttpApi
  lib/core-stack.test.ts
  lib/spike-stack.ts         throwaway: every service later steps need
web/
  package.json, next.config.ts, app/layout.tsx, app/page.tsx, app/globals.css
docs/learn/01-skeleton.md, docs/learn/floci-compat.md
```

---

### Task 1: Repo scaffold + Floci env helper

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `README.md`, `scripts/package.json`, `scripts/tsconfig.json`, `scripts/src/env.ts`
- Test: `scripts/src/env.test.ts`

**Interfaces:**
- Produces: `FLOCI_ENDPOINT = "http://localhost:4566"`; `flociEnv(): Record<string,string>` (AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID=test, AWS_SECRET_ACCESS_KEY=test, AWS_DEFAULT_REGION=us-east-1, AWS_REGION=us-east-1); `assertFlociUp(endpoint?: string, fetchFn?: typeof fetch): Promise<void>` throws `Error("Floci not reachable at <endpoint> — run \`floci start\`")`.

- [ ] **Step 1: Root `package.json`** with `"private": true`, `"workspaces": ["infra","services","web","scripts"]`, scripts `test` (`npm run test --workspaces --if-present`), `deploy:local` (`npm -w scripts run deploy-local`), `spike` (`npm -w scripts run spike`). Dev deps at root: `typescript@^5`, `vitest@^5`, `tsx`, `@types/node`.
- [ ] **Step 2: Write failing test** `env.test.ts`:
  - `flociEnv().AWS_ENDPOINT_URL === "http://localhost:4566"` and keys are `test`.
  - `assertFlociUp` with a `fetchFn` that rejects → throws message containing `run \`floci start\``.
  - `assertFlociUp` with a `fetchFn` resolving `{ ok: true }` for `/_floci/health` (fall back to any HTTP response = up) → resolves.
- [ ] **Step 3: Run** `npm -w scripts test` → FAIL (module missing).
- [ ] **Step 4: Implement `env.ts`.** `assertFlociUp` fetches `${endpoint}/_floci/health` with a 3 s `AbortSignal.timeout`; any HTTP response counts as up, network error/timeout throws.
- [ ] **Step 5: Run** `npm install` then `npm -w scripts test` → PASS.
- [ ] **Step 6: Commit** `chore: repo scaffold + floci env helper`.

### Task 2: Stage config with safety guard

**Files:**
- Create: `infra/package.json`, `infra/tsconfig.json`, `infra/cdk.json`, `infra/lib/config.ts`
- Test: `infra/lib/config.test.ts`

**Interfaces:**
- Produces: `type Stage = "local" | "aws"`; `interface StageConfig { stage: Stage; prefix: string; celebThreshold: number; isLocal: boolean }`; `loadConfig(stage: string | undefined, env: NodeJS.ProcessEnv): StageConfig`.

- [ ] **Step 1: Write failing tests:**
  - `loadConfig("local", { AWS_ENDPOINT_URL: "http://localhost:4566" })` → `{ stage:"local", prefix:"ig-local", celebThreshold:3, isLocal:true }`.
  - `loadConfig("aws", {})` → `{ prefix:"ig-aws", celebThreshold:10000, isLocal:false }`.
  - `loadConfig("local", {})` throws `/AWS_ENDPOINT_URL must point at Floci/`.
  - `loadConfig("local", { AWS_ENDPOINT_URL: "https://s3.amazonaws.com" })` throws same.
  - `loadConfig("aws", { AWS_ENDPOINT_URL: "http://localhost:4566" })` throws `/unset AWS_ENDPOINT_URL/`.
  - `loadConfig(undefined, …)` and `loadConfig("prod", …)` throw `/stage must be local or aws/`.
- [ ] **Step 2: Run** `npm -w infra test` → FAIL.
- [ ] **Step 3: Implement `loadConfig`.** Local endpoint valid if host is `localhost`, `127.0.0.1` or ends with `.floci.io`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(infra): stage config with local/aws guard`.

### Task 3: Health Lambda + CoreStack deployed to Floci

**Files:**
- Create: `services/package.json`, `services/src/http.ts`, `services/src/health.ts`, `infra/bin/app.ts`, `infra/lib/core-stack.ts`, `scripts/src/deploy-local.ts`
- Test: `services/src/health.test.ts`, `infra/lib/core-stack.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `flociEnv`, `assertFlociUp`.
- Produces: `json(statusCode: number, body: unknown): APIGatewayProxyResultV2` (sets `content-type: application/json`, CORS `access-control-allow-origin: *`); `handler` in `health.ts` returns `json(200, { ok: true, stage: process.env.STAGE, time: <ISO string> })`; `class CoreStack extends Stack` with props `{ config: StageConfig }`, public `table: dynamodb.TableV2`, `api: apigwv2.HttpApi`; CfnOutputs `ApiUrl`, `TableName`. Table: name `<prefix>-main`, PK `pk` (S), SK `sk` (S), GSI `gsi1` on `gsi1pk`/`gsi1sk`, TTL attribute `ttl`, on-demand billing, DESTROY. Function `<prefix>-health`, env `STAGE`, `TABLE_NAME`. Route `GET /health`. HttpApi CORS: all origins, methods GET/POST/PUT/DELETE, header `authorization,content-type`.

- [ ] **Step 1: Failing test** `health.test.ts`: with `STAGE=local`, handler result `statusCode === 200`, parsed body `ok === true`, `stage === "local"`, `time` parses as a date, header `content-type` is `application/json`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement `http.ts` + `health.ts`. **Step 4:** run → PASS.
- [ ] **Step 5: Failing test** `core-stack.test.ts` (CDK `Template.fromStack`): table has `KeySchema` pk HASH / sk RANGE, `BillingMode PAY_PER_REQUEST`, GSI `gsi1`, TTL `ttl`; one `AWS::Lambda::Function` with `Runtime nodejs22.x` and env `STAGE`; an `AWS::ApiGatewayV2::Route` with `RouteKey "GET /health"`; **no** `AWS::EC2::*`, `AWS::RDS::*`, `Custom::*` resources.
- [ ] **Step 6: Run** → FAIL. **Step 7:** implement `CoreStack` + `bin/app.ts` (stack id `ig-<stage>-core`, `env: { account: process.env.CDK_DEFAULT_ACCOUNT ?? "000000000000", region: "us-east-1" }` for local). **Step 8:** run → PASS.
- [ ] **Step 9: Implement `deploy-local.ts`**: `assertFlociUp()`; spawn (with `flociEnv()` merged into env, `shell: true`, quoted cwd) `npx cdk bootstrap aws://000000000000/us-east-1 -c stage=local` then `npx cdk deploy ig-local-core -c stage=local --require-approval never --outputs-file cdk.out/outputs-local.json`; print `ApiUrl`.
  Fallbacks if `cdk deploy` fails against Floci, in this order (record which one worked in `floci-compat.md`): (a) `cdk deploy` with `-c @aws-cdk/core:bootstrapQualifier` defaults but `--no-previous-parameters`; (b) `cdk synth` then `aws cloudformation deploy` of `cdk.out/ig-local-core.template.json` after uploading assets with `cdk-assets`; (c) `npx aws-cdk-local` (cdklocal). If all fail, stop and report to Aman.
- [ ] **Step 10: Verify** `npm run deploy:local` → prints ApiUrl; `curl <ApiUrl>/health` → `{"ok":true,"stage":"local",...}`. Run deploy again → succeeds with "no changes". Run `floci reset` (or `floci restart`) then deploy again → succeeds.
- [ ] **Step 11: Commit** `feat: core stack with health endpoint deployed to Floci`.

### Task 4: Floci spike: every later service, checked + report

**Files:**
- Create: `infra/lib/spike-stack.ts` (registered in `bin/app.ts` only when `-c spike=true`), `scripts/src/spike-check.ts`, `scripts/src/checks/{cognito,s3sqs,stepfunctions,eventbridge,sns,secrets,cloudwatch}.ts`, `docs/learn/floci-compat.md`
- Test: `scripts/src/spike-check.test.ts` (report rendering only)

**Interfaces:**
- Consumes: `CoreStack` outputs not needed; `flociEnv`, `assertFlociUp`, `loadConfig`.
- Produces: `interface CheckResult { service: string; feature: string; ok: boolean; notes: string; ms: number }`; each check file exports `run(outputs: Record<string,string>): Promise<CheckResult[]>`; `renderReport(results: CheckResult[], meta: { flociVersion: string; date: string }): string` (markdown table `| Service | Feature | Works? | Notes |`, ✅/❌, plus a "Workarounds needed" section listing failures).

SpikeStack `ig-local-spike` resources (all with outputs named below):
- Cognito user pool + app client (no secret, `USER_PASSWORD_AUTH`) → `UserPoolId`, `ClientId`; HttpApi `GET /private` behind `HttpJwtAuthorizer` (issuer = pool's issuer URL) → `PrivateUrl`, backed by a tiny inline Lambda returning `{ sub }` from JWT claims.
- S3 bucket `ig-local-spike-uploads` with `ObjectCreated:*` → SQS `ig-local-spike-uploads` → `UploadBucket`, `UploadQueueUrl`.
- Step Functions standard state machine: Pass → Lambda task (echo) → Succeed → `StateMachineArn`.
- EventBridge bus `ig-local-spike-bus`, rule `source=ig.spike` → SQS `ig-local-spike-events` → `BusName`, `EventsQueueUrl`.
- SNS topic → SQS subscription (raw delivery) → `TopicArn`, `SnsQueueUrl`.
- Secrets Manager secret `ig-local-spike-secret` (generated string) → `SecretArn`.
- SQS `ig-local-spike-dlq` + CloudWatch alarm `ApproximateNumberOfMessagesVisible > 0` with SNS action to the topic above → `AlarmName`, `DlqUrl`.

Checks (each records ok/notes, never throws past its own result):
- cognito: `SignUp` → `AdminConfirmSignUp` → `InitiateAuth` gets IdToken/AccessToken; `GET PrivateUrl` with token → 200 and `sub` matches; without token → 401.
- s3sqs: presigned PUT (`@aws-sdk/s3-request-presigner`) of a small PNG via `fetch` → 200; SQS receives an S3 event naming the key within 20 s.
- stepfunctions: `StartExecution` → `DescribeExecution` reaches `SUCCEEDED` within 30 s; output echoes input.
- eventbridge: `PutEvents` with `source: "ig.spike"` → message on events queue within 20 s.
- sns: `Publish` → message on SNS queue within 20 s.
- secrets: `GetSecretValue` returns a non-empty string.
- cloudwatch: send a message to DLQ, `SetAlarmState ALARM` (and, separately, wait up to 90 s for real evaluation) → SNS queue receives alarm notification; note whether real evaluation fired or only `SetAlarmState`.
- Also record: CloudFront? **No** (step 7). Lambda in Docker cold start time (from first check `ms`).

- [ ] **Step 1: Failing test** `spike-check.test.ts`: `renderReport([{service:"SQS",feature:"x",ok:true,notes:"",ms:5},{service:"SNS",feature:"y",ok:false,notes:"timeout",ms:20000}], {flociVersion:"2.4.0",date:"2026-11-06"})` contains `| SQS | x | ✅ |`, `| SNS | y | ❌ | timeout |`, and a `## Workarounds needed` section containing `SNS`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement `renderReport`. **Step 4:** run → PASS.
- [ ] **Step 5: Ensure Floci JWT flag.** Check `floci config --help`; set `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS=true` via `floci config` or restart the container with that env (`floci restart`). Document the exact command in `floci-compat.md`.
- [ ] **Step 6: Implement SpikeStack + checks + `spike-check.ts`** (`npm run spike` = deploy `ig-local-spike` with `-c stage=local -c spike=true`, run all checks, write `docs/learn/floci-compat.md`, then `cdk destroy ig-local-spike --force`).
- [ ] **Step 7: Verify** `npm run spike` → report written; every row has ✅ or ❌ with notes; spike stack destroyed (`aws cloudformation describe-stacks` no longer lists it).
- [ ] **Step 8:** If any ❌: add to report "Proposed workaround" per row, and **flag to Aman** in the step summary (do not redesign).
- [ ] **Step 9: Commit** `feat: floci spike + compatibility report`.

### Task 5: Next.js hello page + learn doc

**Files:**
- Create: `web/package.json`, `web/next.config.ts`, `web/tsconfig.json`, `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/globals.css`, `web/.env.local` (gitignored, written by deploy-local), `docs/learn/01-skeleton.md`
- Modify: `scripts/src/deploy-local.ts` (write `web/.env.local` with `NEXT_PUBLIC_API_URL=<ApiUrl>`), `docs/learn/system-design-notes.md` (add "2. Infrastructure as code + environments")

**Interfaces:**
- Consumes: CoreStack output `ApiUrl`.
- Produces: `web` build to `web/out/` (static export), used by step 7.

- [ ] **Step 1:** `next.config.ts` with `output: "export"`, `images: { unoptimized: true }`.
- [ ] **Step 2:** `page.tsx` (client component): title "Instagram-lite", fetches `${NEXT_PUBLIC_API_URL}/health`, shows one of three states: "Checking…", "API ok · stage local · <time>", or "API unreachable. Is Floci running?". Plain calm CSS, system font, no gradients/glow.
- [ ] **Step 3: Verify** `npm -w web run build` → `web/out/index.html` exists. `npm -w web run dev`, open `http://localhost:3000` → "API ok · stage local". Stop Floci → reload → "API unreachable" state. Start Floci again.
- [ ] **Step 4: Learn doc** `docs/learn/01-skeleton.md`: what got built, a mermaid diagram (Browser → HTTP API → Lambda → DynamoDB, CDK → CloudFormation → Floci), why IaC + stages, the safety guard, "interview angle" (environments, IaC, why serverless), commands to poke it (`aws dynamodb describe-table`, `aws lambda list-functions`, `curl /health`, `floci logs`). Add section 2 to `system-design-notes.md`.
- [ ] **Step 5: Run full suite** `npm test` → all PASS.
- [ ] **Step 6: Commit** `feat(web): hello page + step 1 learn doc`.
- [ ] **Step 7: Stop.** Short chat summary (what works, compat ✅/❌ count, anything flagged) and wait for Aman's OK before step 2.
