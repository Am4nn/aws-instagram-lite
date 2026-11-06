# Step 2: Auth + Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users sign up / log in with Cognito from the Next.js app, pick a unique username, and view/edit profiles through JWT-protected Lambda routes backed by the single DynamoDB table.

**Architecture:** Cognito user pool (username sign-in, PreSignUp Lambda auto-confirms) + app client (USER_PASSWORD_AUTH) added to `CoreStack`. HTTP API gets a JWT authorizer (issuer per stage). One `users` Lambda serves `/me` and `/users/{username}` using a repository module over the DynamoDB DocumentClient; username uniqueness via a claim item in a `TransactWrite`. The browser talks to Cognito with the AWS SDK (endpoint = Floci locally) and stores tokens in localStorage.

**Tech Stack:** as step 1 plus `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` 3.1163 (services), `@aws-sdk/client-cognito-identity-provider` (web).

**Spec:** `docs/superpowers/specs/2026-11-06-instagram-lite-design.md`

## Global Constraints

- All step 1 constraints apply (stages, `ig-<stage>-` names, no custom resources, nodejs22.x, local esbuild, serverless only).
- Floci container env now also has `FLOCI_SECURITY_EXTRA_CORS_ALLOWED_ORIGINS=http://localhost:3000` (+ SDK headers) so the browser can call Cognito on Floci.
- JWT issuer: local `http://127.0.0.1:4566/<poolId>` (config.cognitoIssuerBase); aws `https://cognito-idp.<stack region>.amazonaws.com/<poolId>` from `Stack.of(this).region` (fixes deferred minor: region mismatch).
- Keys (spec table): profile `pk=USER#<sub>, sk=PROFILE`; claim `pk=UNAME#<username>, sk=UNAME`.
- Username rule: `^[a-z0-9_]{3,20}$` (lowercased before checking). Bio ≤ 150 chars.
- Errors are JSON `{ "error": "<message>" }` with 400 / 401 / 404 / 409.
- Learning style: `docs/learn/02-auth-profile.md` + new sections in `system-design-notes.md` + add to the study list `docs/learn/README.md`.

## Review Focus

1. **Username race:** two users claim the same name at once → exactly one wins, other gets 409. → integration test in Task 3.
2. **Rename keeps uniqueness and frees the old name** (old claim deleted, new claim taken atomically). → integration test in Task 3.
3. **Mixed-case / whitespace usernames** ("Alice ", "ALICE") map to the same claim. → unit test in Task 2.
4. **Expired / missing token** in the UI → user is sent back to login, not a blank page. → Task 5 handles 401 by clearing session.
5. **Profile not created yet** (`GET /me` before choosing a username) → 404 the UI turns into the "choose a username" form. → Task 4 test + Task 5.

---

## File Structure

```
infra/lib/config.ts                 cognitoIssuerBase becomes local-only (optional)
infra/lib/core-stack.ts             + Cognito pool/client, PreSignUp fn, JWT authorizer, users fn + routes
infra/lib/core-stack.test.ts        + assertions
services/src/lib/http.ts            (moved from src/http.ts) json(), error helpers
services/src/lib/db.ts              DocumentClient factory
services/src/lib/auth.ts            subFromEvent()
services/src/users/validate.ts      normalizeUsername(), validateProfileInput()
services/src/users/validate.test.ts
services/src/users/repo.ts          getProfile, getProfileByUsername, upsertProfile
services/src/users/repo.int.test.ts integration tests against Floci DynamoDB
services/src/users/handler.ts       routes: GET/PUT /me, GET /users/{username}
services/src/users/handler.test.ts  handler tests with injected repo
services/src/auth/presignup.ts      auto-confirm trigger
web/lib/config.ts, web/lib/auth.ts, web/lib/api.ts
web/app/page.tsx (home), web/app/login/page.tsx, web/app/me/page.tsx, web/app/u/page.tsx (?name=)
scripts/src/smoke-auth.ts           end-to-end: sign up → PUT /me → GET /users/{name}
docs/learn/02-auth-profile.md, docs/learn/README.md, docs/learn/system-design-notes.md
```

### Task 1: Cognito + JWT authorizer in CoreStack

**Interfaces:**
- Produces: CfnOutputs `UserPoolId`, `UserPoolClientId`; `CoreStack.authorizer: HttpJwtAuthorizer`; `CoreStack.addFunction(name, entry, env?)` helper returning `NodejsFunction` with table access, `STAGE` + `TABLE_NAME` env; `StageConfig.cognitoIssuerBase?: string` (local only).
- Pool `<prefix>-users`: self sign-up, sign-in alias username, password min 8 (no symbol/upper requirement), PreSignUp trigger `<prefix>-presignup` (`event.response.autoConfirmUser = true`), DESTROY. Client: `authFlows.userPassword`, no secret.

- [ ] Failing tests (core-stack.test): one `AWS::Cognito::UserPool` with `LambdaConfig.PreSignUp`; `AWS::ApiGatewayV2::Authorizer` type JWT with `JwtConfiguration.Issuer` joining `http://127.0.0.1:4566/` + pool ref; config.test: aws config has no `cognitoIssuerBase`.
- [ ] Implement; tests green; commit `feat(infra): cognito pool + JWT authorizer`.

### Task 2: Validation (pure)

**Interfaces:** `normalizeUsername(raw: string): string` (trim + lowercase); `validateProfileInput(body: unknown): { ok: true; value: { username: string; bio: string } } | { ok: false; error: string }`.

- [ ] Failing tests: `"  Alice_1 "` → `"alice_1"`; `"ab"` → error `/3-20/`; `"bad-name"` → error; bio of 151 chars → error `/150/`; missing bio → `""`; non-object body → error.
- [ ] Implement; green; commit.

### Task 3: Profile repository (integration tests on Floci)

**Interfaces:** `type Profile = { userId; username; bio; followerCount; followingCount; postCount; createdAt }`; `getProfile(userId): Promise<Profile | null>`; `getProfileByUsername(username): Promise<Profile | null>`; `upsertProfile(userId, input: {username, bio}): Promise<Profile>` throws `UsernameTakenError`. Repo takes `(doc: DynamoDBDocumentClient, table: string)` via `makeUsersRepo(doc, table)`.
Upsert = `TransactWrite`: if username changed → `Put UNAME#new` with `attribute_not_exists(pk)` + `Delete UNAME#old` (condition owner = userId) + `Put/Update USER#id PROFILE`; counters start at 0 and are never overwritten.

- [ ] Integration test file `repo.int.test.ts` (runs with `npm -w services run test:int`, needs Floci + deployed table, uses unique ids per run): create → get by id and by name; second user same name → `UsernameTakenError`; **race**: two upserts for the same new name in `Promise.allSettled` → exactly one fulfilled; rename → old name lookup null, new name resolves, a third user can now take the old name; counters preserved across bio edit.
- [ ] Implement; green; commit.

### Task 4: users Lambda handler + routes

**Interfaces:** `makeHandler(repo)` returns `(event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<Result>`; exported `handler` wires the real repo. Routes: `GET /me` (200 profile | 404 `{error:"no profile yet"}`), `PUT /me` (200 | 400 | 409), `GET /users/{username}` (200 | 404). All behind the JWT authorizer.

- [ ] Failing handler tests with an in-memory fake repo: each status above; username taken → 409 `{error:"username taken"}`; invalid JSON body → 400.
- [ ] Implement handler + add routes in CoreStack (+ test that the three routes exist with `AuthorizationType: JWT`); deploy:local; green; commit.

### Task 5: Web auth + profile pages

**Interfaces:** `web/lib/auth.ts`: `signUp(username, password)`, `signIn(username, password)`, `signOut()`, `getIdToken(): string | null` (localStorage `ig.session`, cleared when expired); `web/lib/api.ts`: `api<T>(path, init?)` adds `Authorization: Bearer`, on 401 clears session and redirects to `/login`. Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USER_POOL_CLIENT_ID`, `NEXT_PUBLIC_COGNITO_ENDPOINT` (local `http://localhost:4566`, written by deploy-local).
Pages: `/login` (sign in / create account toggle), `/` (redirect to `/me`), `/me` (shows profile or "choose a username" form; edit bio), `/u?name=` (public profile; static export can't do `[username]` dynamic routes without generateStaticParams, so query param).

- [ ] Update `webEnvFile` test → 3 vars; deploy-local writes them. Green.
- [ ] Build pages; `npm -w web run build` passes.
- [ ] `scripts/src/smoke-auth.ts` (`npm run smoke`): SDK sign up → sign in → `PUT /me` → `GET /users/<name>` → `GET /me` with no token = 401. Passes against Floci.
- [ ] Headless Chrome: `/login` renders; after smoke user exists, a scripted sign-in is out of scope for headless (no forms automation): verify pages render and build. Commit.

### Task 6: Learn docs

- [ ] `docs/learn/02-auth-profile.md` (what/why/diagram: sign-up → trigger → tokens → API authorizer → Lambda → DynamoDB; JWT anatomy; interview angle; poke-it commands).
- [ ] `system-design-notes.md`: "3. Authentication with JWTs" and "4. DynamoDB single-table + uniqueness with transactions".
- [ ] `docs/learn/README.md`: study list, ordered, with checkboxes, covering steps 1-2.
- [ ] Full suite green; commit; merge to master.
