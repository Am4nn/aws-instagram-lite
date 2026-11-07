# Step 8: putting it on real AWS

Everything so far runs on Floci. Step 8 deploys the **same CDK code** with `-c stage=aws`
to **ap-south-1 (Mumbai)**. Stack: `ig-aws-core`. The code is ready; these are the steps.

## 1. Create the account (you, ~15 min)
- [ ] Sign up at aws.amazon.com (needs a card; the free tier covers this project)
- [ ] **Root user: turn on MFA** right away, then stop using root
- [ ] **Budgets → Monthly cost budget template, $5**, email alerts at 85% / 100% ← first thing
- [ ] **IAM → Users → create `aman`** with console access + `AdministratorAccess` + MFA, then sign in as it.
  Not IAM Identity Center: on a Free plan account it creates an AWS Organization, which permanently moves you to the Paid plan.
- [ ] Install nothing new: AWS CLI v2 and CDK are already installed

## 2. Log in from the terminal (you)
```powershell
aws login --profile ig --region ap-south-1   # browser sign-in as aman; short-lived creds, no access keys (CLI ≥ 2.32)
aws sts get-caller-identity --profile ig    # check: ...:user/aman
```

## 3. Deploy
```powershell
Remove-Item Env:AWS_ENDPOINT_URL -ErrorAction SilentlyContinue   # the scripts refuse while it's set
npm run deploy:aws -- --bootstrap                       # first time (bootstraps CDK in the account)
npm run deploy:aws                                      # every later deploy
npm run deploy:aws -- --alert-email=you@example.com     # optional: alarm emails (click the link AWS sends)
npm run seed:aws                                        # optional: demo users (password1), e.g. bob
```
`deploy:aws` uses profile `ig` (override with `AWS_PROFILE`), deploys the stack, builds the web app
against the real API + Cognito (web/.env.local stays on Floci), uploads it, invalidates CloudFront
and prints the **https** URL. A brand-new distribution can take a few minutes to answer.

Then walk the console: Lambda, Step Functions (watch an upload run!), DynamoDB items,
CloudWatch Logs Insights, alarms, X-Ray (optional).

## 4. Clean up (important)
```powershell
npm run destroy:aws
```
Empties the `ig-aws-*` buckets, runs `cdk destroy`, force-deletes the cursor secret. On aws everything
is `DESTROY` (table included, fine for a learning project; a real app would keep its data).
The `CDKToolkit` bootstrap stack stays (cents/month). Check Billing the next day.

## Decisions (made)
- **Email verification on AWS**: sign-up asks for an email, Cognito mails a 6-digit code (default
  sender, ~50 mails/day), the login page asks for it ("resend the code" included). Local keeps auto-confirm.
- **CORS on AWS** = only `https://<distribution>.cloudfront.net`, for the API and for browser uploads
  to S3. Local stays `*`.
- **CloudFront on AWS**: real 404s (`/404.html`; OAC may list the bucket, so a 403 is a real access
  error), AWS-managed security headers, price class 200 (includes India edges).

## Expected cost (light use, a few days)
Mostly free tier. Secrets Manager is about $0.40/month (prorated), CloudWatch alarms: the first 10 are free (we have 6).
**Never** created: NAT gateways, RDS, load balancers (the cost rule from the design).

## Known gaps to check on AWS
Step Functions metrics alarm (Floci couldn't emit it), the email-code flow end to end (only
simulated locally), alarm email delivery.
