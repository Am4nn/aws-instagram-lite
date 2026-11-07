# Step 9: Server-side rendering (SSR) the way companies run Next.js on AWS

Status: draft, waiting for Aman's OK. Decided with Aman on 2026-11-07:
OpenNext on Lambda · full scope (cookies + every page + one domain) · Floci first, then AWS · site at `lite.amanarya.com`.

## Why
Today the site is a static export: empty HTML shells, then the browser fetches data with a token kept in
`localStorage`. Real products render on the server for a fast first paint and link previews, and keep tokens out
of JavaScript. Step 9 rebuilds hosting and login into the setup Vercel-style platforms (OpenNext/SST) use on AWS,
so Aman can explain it in an interview and has run it himself.

## Goals
1. **Every page is rendered on the server** (feed, profile, post, notifications, me), and the HTML arrives with the data already in it.
   Interactivity (like, comment, follow, upload, load more) still works in the browser.
2. **Login uses httpOnly cookies.** No token is ever readable by JavaScript.
3. **One domain** serves the pages, the static assets and the photos, so there's no CORS and photos are cached at the edge.
4. **Serverless:** about $0 when idle, and still no VPC, NAT or RDS.
5. **It runs on Floci first, then on AWS.** Every Floci gap gets written down in `docs/learn/floci-compat.md`.

## Non-goals
- ISR or on-demand revalidation. Pages are personal, so there's nothing to share between users. That means no OpenNext revalidation queue or tag-cache table.
- Next.js image optimization. The pipeline already makes thumbnails, so `images.unoptimized` stays.
- Edge middleware or Lambda@Edge.
- Changing the backend Lambdas' business logic.

## Anti-goals (a failure even if it "works")
- A token readable from JS, or any credential in a URL.
- An always-on server, a VPC, or a monthly floor above a few cents.
- Losing a working feature from steps 1–8: email sign-up, upload pipeline, likes, notifications, the celebrity feed.

## Architecture

```
Browser ── https://lite.amanarya.com ── CloudFront
   /_next/static/*   → S3 web bucket            (immutable, cached 1 yr at edge)
   /media/*          → S3 media bucket (OAC)    (thumbs/full JPEGs, cached at edge)
   everything else   → Lambda "web-server"      (OpenNext, Function URL + OAC, never cached)
                          │  cookie ig_id (Cognito ID token, httpOnly)
                          ▼
                      HTTP API (JWT authorizer, unchanged)  → service Lambdas → DynamoDB
```

**BFF (backend-for-frontend) pattern:** the browser talks *only* to the Next.js server.
- **Server components** read the `ig_id` cookie and call the HTTP API server-to-server with `Authorization: Bearer`.
- **Browser actions** (like, comment, follow, load more, create post) go to Next.js **route handlers** under `/bff/*`. These forward the call to the API with the cookie's token.
- The HTTP API stays exactly as it is, and the JWT authorizer still checks every call. Its CORS can be removed, because no browser calls it any more.

**Auth flow:**
- `/login` posts to route handlers `/bff/auth/{signin,signup,confirm,resend,signout}`. These call Cognito server-side (`USER_PASSWORD_AUTH`) and set two cookies:
  - `ig_id`: the ID token; `HttpOnly; Secure; SameSite=Lax; Path=/`; Max-Age matches the token (1 h).
  - `ig_refresh`: the refresh token; `HttpOnly; Secure; SameSite=Lax; Path=/bff/auth`; 30 days.
- **Expired `ig_id`:** the server swaps the refresh token for a new ID token before rendering. This happens in Next 16's `proxy.ts`, which used to be called middleware. If the refresh fails, the server redirects to `/login`.
- **CSRF:** `SameSite=Lax`. In addition, every `/bff/*` mutation requires `Origin` to equal the site origin and a JSON body. This is the standard pair of defenses.
- **Locally (http)**, `Secure` is off. On AWS (https) it's on.

**Uploads:** the browser still PUTs the photo straight to S3 with a presigned URL. Photo bytes never pass through Lambda; that's the standard approach. The uploads bucket's CORS allows only the site origin.

**Photos:** the posts and feed APIs return `/media/<key>` paths instead of presigned S3 GET URLs. CloudFront reads the media bucket with OAC.
- Tradeoff: anyone with a photo's URL can view it, just like Instagram's CDN URLs.
- Keys contain random post IDs, so they can't be guessed.
- Signed CloudFront cookies are written up as the "private photos" upgrade but not built.

**Packaging:** `@opennextjs/aws` (4.1.x, supports Next ≥ 16.4.5) builds `web/.open-next/`. Our own CDK construct `infra/lib/web.ts` deploys it:
- the server function: Node 22, 1024 MB, streaming via Function URL;
- the assets to S3.

We use our own construct rather than SST or `cdk-nextjs`, so every resource is visible and explainable.

**Static export is removed.** `output: "export"` and the `?id=` query-string routes become real dynamic routes (`/p/[id]`, `/u/[name]`). Old `?id=` links redirect.

## Spike results (2026-11-07, Floci 2.4.0) and the decisions they force
- **Lambda Function URL works:** the path, query string and `Cookie` reach the event, and `cookies: [...]` in the response comes back as `Set-Cookie`. Locally, call it by host: `<id>.lambda-url.us-east-1.localhost.floci.io:4566`.
- **CloudFront → Function URL works** once the *exact* host is listed in `FLOCI_SERVICES_CLOUDFRONT_ALLOWED_PRIVATE_ORIGIN_HOSTS`. Wildcards are ignored. The deploy script writes it to `.env` as `SSR_ORIGIN_HOST`, and docker-compose reads it, the same way as `WEB_ORIGIN`.
  - Path-pattern behaviours (`/_next/static/*`, `/media/*`) on Floci weren't tested yet, so the build must verify them.
- **Decision: no streaming.** Use OpenNext's plain `aws-lambda` wrapper, not `aws-lambda-streaming`. It's simpler, works on Floci, and our pages are small.
- **Decision: protect the Function URL with a secret origin header, not OAC.**
  - With OAC on a Lambda Function URL, every POST from the browser must carry `x-amz-content-sha256`, which would break plain form and fetch POSTs. OAC also isn't emulated on Floci.
  - So: `authType: NONE`. CloudFront adds `x-origin-verify: <random secret>`, and `proxy.ts` rejects any request without it with 403. The secret is generated per stage and passed to both CloudFront and the Lambda.
  - OAC + signed hashes is documented as the stricter upgrade.

## Floci first
The first task was a **spike** that answers three questions:
1. Does Floci run a Lambda Function URL?
2. Can Floci's CloudFront use that URL as an origin?
3. Does response streaming work?

If any answer is no:
- `npm run dev:ssr` runs the OpenNext server locally (or `next start`) against the Floci API.
- On Floci, CloudFront keeps serving assets and media only.
- The gap gets recorded in `floci-compat.md`.
- The AWS path is unchanged.

## Testing
- **Unit tests:** cookie options (httpOnly/Secure/SameSite), the Origin check, refresh-on-expiry, and the BFF forwarding (token from cookie → Bearer, 401 → clears cookies).
- **CDK assertions:**
  - 3 behaviours (static, media, default → Function URL);
  - OAC on all 3 origins;
  - default behaviour uses `CachingDisabled` and forwards cookies;
  - API CORS removed;
  - media OAC policy.
- **Smoke test (Floci, then AWS):**
  - the HTML of `/feed` for bob contains a post caption, with no client fetch needed;
  - `document.cookie` has no token;
  - like, comment, follow, upload and notifications all work;
  - logged out, `/feed` redirects to `/login`.
- Screenshots via `shots.ts` before and after.

## Left to the builder
File layout inside `web/lib/server/*`, the exact `/bff/*` route shapes, and how loading states look while the browser loads more.

## Cost on AWS
- One more Lambda. Idle cost is $0, and per request it's fractions of a cent.
- Function URL + OAC costs nothing extra.
- CloudFront requests are already covered by the Free plan credits.
