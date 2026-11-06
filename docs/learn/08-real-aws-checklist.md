# Step 8 (next, with you): putting it on real AWS

Everything so far runs on Floci. Step 8 deploys the **same CDK code** with `-c stage=aws`.
Some of it only you can do (account, card, MFA), so here's the checklist. We'll do it together.

## 1. Create the account (you, ~15 min)
- [ ] Sign up at aws.amazon.com (needs a card; the free tier covers this project)
- [ ] **Root user: turn on MFA** right away, then stop using root
- [ ] **Billing → Budgets → create a $5 monthly budget** with email alerts at 50% / 100% ← first thing
- [ ] IAM Identity Center → create a user for yourself with `AdministratorAccess` (for learning)
- [ ] Install nothing new: AWS CLI v2 and CDK are already installed

## 2. Log in from the terminal (you)
```powershell
aws configure sso          # profile name: ig
aws sso login --profile ig
```

## 3. Deploy (me, with you watching)
- Bootstrap once: `cdk bootstrap` in your account/region
- `cdk deploy ig-aws-core -c stage=aws --profile ig`. The stage guard refuses if `AWS_ENDPOINT_URL` is set.
- Build the web app with the real API URL + Cognito client id, upload to the web bucket, open the **https** CloudFront URL
- Walk the console together: Lambda, Step Functions (watch an upload run!), DynamoDB items,
  CloudWatch Logs Insights, alarms, X-Ray (optional)

## 4. Clean up (important)
- `cdk destroy ig-aws-core -c stage=aws`. Empty the buckets first; we'll script it.
- Check Billing the next day.

## Decisions I'll ask you then
- Keep **auto-confirm sign-up** on AWS, or require email verification? (Anyone with the URL could create accounts.)
- Narrow CORS from `*` to the CloudFront domain? (Recommended.)

## Expected cost (light use, a few days)
Mostly free tier. Secrets Manager is about $0.40/month (prorated), CloudWatch alarms: the first 10 are free (we have 5).
**Never** created: NAT gateways, RDS, load balancers (the cost rule from the design).

## Already fixed for AWS during the reviews
Transaction-conflict retries (likes, follows, usernames, posts), signed upload sizes, upload
lifecycle cleanup, region-correct Cognito issuer, globally unique bucket names, log retention.
Known gaps to check on AWS: Step Functions metrics alarm (Floci can't emit it), the 404 page via CloudFront.
