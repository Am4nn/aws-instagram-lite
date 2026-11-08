# Instagram-lite on AWS

A learning project: an Instagram-style app built the way companies ship on AWS (CDK, serverless,
event-driven). It runs fully on your laptop via [Floci](https://floci.io), and later on a real AWS account.

**Start here:** [docs/learn/README.md](docs/learn/README.md) (study list, step by step).

## Run locally

```powershell
# once (Docker Desktop running)
npm install
npm run floci:up          # local AWS (keeps state across restarts)
npm run deploy:local      # deploy the stack to Floci, writes web/.env.development.local
npm run seed              # demo users: alice, bob, carol, dave, eve, star (password: password1)

# then either
npm run deploy:web        # the "production" way: Next.js server on Lambda behind CloudFront (prints the URL)
npm -w web run dev        # or the dev server: http://localhost:3000
```

## Deploy to real AWS
See [docs/learn/08-real-aws-checklist.md](docs/learn/08-real-aws-checklist.md). Optional settings (alarm email, custom domain + ACM cert)
go in `infra/cdk.context.json` (gitignored, the CDK CLI reads it automatically): copy
`infra/cdk.context.example.json` and fill in your values.

## Check it
```powershell
npm test                          # unit + template tests
npm -w services run test:int      # integration tests against DynamoDB on Floci
npm run smoke                     # end to end: auth, pipeline, feed, engage, UI
npm run smoke ops                 # break it on purpose: DLQ → alarm → redrive (~4 min)
npm run smoke ssr                 # server-rendered site through CloudFront: HTML, cookies, CSRF (after deploy:web)
npm run smoke cdn                 # same in a real browser: sign up, upload, like, comment (after deploy:web)
npm run spike                     # regenerate docs/learn/floci-compat.md
npm run ops                       # DLQs + alarms status (see docs/learn/06-ops.md)
```

## Layout
- `infra/`: CDK app (`lib/core-stack.ts` + one file per feature: pipeline, social, engage, ops, web)
- `services/`: Lambda handlers (users, posts, pipeline, social, feed, engage, events, notify)
- `web/`: Next.js app, rendered on the server (OpenNext on Lambda); `app/bff/*` = the browser's only backend
- `scripts/`: deploy, seed, smoke, ops, spike
- `docs/learn/`: one doc per step + system design notes + Floci compatibility report
