# Instagram-lite on AWS

A learning project: an Instagram-style app built the way companies ship on AWS (CDK, serverless,
event-driven). It runs fully on your laptop via [Floci](https://floci.io), and later on a real AWS account.

**Start here:** [docs/learn/README.md](docs/learn/README.md) (study list, step by step).

## Run locally

```powershell
# once (Docker Desktop running)
npm install
npm run floci:up          # local AWS (keeps state across restarts)
npm run deploy:local      # deploy all stacks to Floci, writes web/.env.local
npm run seed              # demo users: alice, bob, carol, dave, eve, star (password: password1)

# then either
npm -w web run dev        # dev server: http://localhost:3000
npm run deploy:web        # or the "production" way: S3 + CloudFront (prints the URL)
```

## Check it
```powershell
npm test                          # unit + template tests
npm -w services run test:int      # integration tests against DynamoDB on Floci
npm run smoke                     # end to end: auth, pipeline, feed, engage, UI
npm run smoke ops                 # break it on purpose: DLQ → alarm → redrive (~4 min)
npm run smoke cdn                 # login through CloudFront (after deploy:web)
npm run spike                     # regenerate docs/learn/floci-compat.md
npm run ops                       # DLQs + alarms status (see docs/learn/06-ops.md)
```

## Layout
- `infra/`: CDK app (`lib/core-stack.ts` + one file per feature: pipeline, social, engage, ops, web)
- `services/`: Lambda handlers (users, posts, pipeline, social, feed, engage, events, notify)
- `web/`: Next.js UI (static export)
- `scripts/`: deploy, seed, smoke, ops, spike
- `docs/learn/`: one doc per step + system design notes + Floci compatibility report
