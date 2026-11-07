# Step 8: putting it on real AWS

Everything so far runs on Floci. Step 8 deploys the **same CDK code** with `-c stage=aws`
to **ap-southeast-2 (Sydney)**. Stack: `ig-aws-core`. The code is ready; these are the steps.

## 1. Create the account (you, ~10 min)
This account uses AWS's **new sign-up experience** (Sept 2026: "projects", Free plan with credits). It differs from
most tutorials:
- [ ] Sign up at aws.amazon.com. The Free plan never charges you until you upgrade, so no budget alert is needed.
- [ ] **MFA:** settings.aws.com → Manage security and sign-in → Security → Register device (register two).
  There is **no root user** (your AWS Builder ID owns the account) and IAM users can't use the console, so skip both.
- [ ] **Region:** fixed per project, picked from your country (India → Sydney `ap-southeast-2`). Mumbai isn't offered.
- [ ] **Don't "Activate advanced features"**: it's irreversible and ends the Free plan. Everything we use works without it.
- [ ] Install nothing new: AWS CLI v2 and CDK are already installed

## 2. Log in from the terminal (you)
```powershell
aws login --profile ig --region ap-southeast-2   # browser: pick your project + session (CLI ≥ 2.32)
aws sts get-caller-identity --profile ig    # check: prints your project's account id
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
