# Instagram-lite on AWS

A learning project: Instagram-style app built the way orgs ship on AWS, with CDK.
Runs fully on your laptop via [Floci](https://floci.io), then on a real AWS account.

## Run locally

1. Start Docker Desktop, then `floci start`
2. `npm install`
3. `npm run deploy:local`: deploys the stack to Floci
4. `npm -w web run dev`: open http://localhost:3000

## Layout

- `infra/` CDK app (stacks)
- `services/` Lambda handlers
- `web/` Next.js UI (static export)
- `scripts/` deploy + spike helpers
- `docs/learn/` one explainer per step + system design notes
