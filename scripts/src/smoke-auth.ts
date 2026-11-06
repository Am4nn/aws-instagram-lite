/**
 * End-to-end check of step 2 against Floci:
 *  API: sign up → sign in → GET /me 404 → PUT /me → GET /users/{name} → no token = 401
 *  UI (headless Chrome, needs `npm -w web run dev`): create account → choose username → profile shows it
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import puppeteer from "puppeteer-core";
import { assertFlociUp, useLocalEnv } from "./env.js";
import { readOutputs } from "./deploy-local.js";
import { localApiUrl } from "./urls.js";

const WEB = "http://localhost:3000";
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`✅ ${msg}`);
}

async function apiFlow(api: string, clientId: string) {
  const idp = new CognitoIdentityProviderClient({});
  const login = `smoke${randomUUID().slice(0, 6)}`;
  await idp.send(new SignUpCommand({ ClientId: clientId, Username: login, Password: "password1" }));
  const auth = await idp.send(new InitiateAuthCommand({
    ClientId: clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: login, PASSWORD: "password1" },
  }));
  const headers = { authorization: `Bearer ${auth.AuthenticationResult!.IdToken}`, "content-type": "application/json" };
  ok((await fetch(`${api}/me`, { headers })).status === 404, "API: GET /me before profile → 404");
  const put = await fetch(`${api}/me`, { method: "PUT", headers, body: JSON.stringify({ username: login, bio: "smoke" }) });
  ok(put.status === 200, "API: PUT /me → 200");
  const got = await fetch(`${api}/users/${login.toUpperCase()}`, { headers }).then((r) => r.json());
  ok(got.username === login, "API: GET /users/{NAME} is case-insensitive");
  ok((await fetch(`${api}/me`)).status === 401, "API: no token → 401");
}

async function uiFlow() {
  if (!CHROME) return console.log("⚠️  UI: no Chrome/Edge found, skipped");
  const up = await fetch(WEB).then(() => true, () => false);
  if (!up) return console.log("⚠️  UI: web dev server not running (npm -w web run dev), skipped");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    const login = `ui${randomUUID().slice(0, 6)}`;
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await page.click("button.link"); // switch to "Create account"
    await page.type('input[autocomplete="username"]', login);
    await page.type('input[type="password"]', "password1");
    await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.click('button[type="submit"]')]);
    ok(page.url().endsWith("/me"), "UI: create account signs in and lands on /me");
    await page.waitForSelector("form.card h2", { timeout: 20000 });
    const heading = await page.$eval("form.card h2", (el) => el.textContent);
    ok(heading === "Choose a username", "UI: new user is asked to choose a username");
    await page.type("form.card input", login);
    await page.type("form.card textarea", "made by the smoke test");
    await page.click('form.card button[type="submit"]');
    await page.waitForSelector(".profile h1", { timeout: 20000 });
    ok((await page.$eval(".profile h1", (el) => el.textContent)) === `@${login}`, "UI: profile shows the chosen username");
    await page.screenshot({ path: "../docs/learn/img/02-profile.png" });
  } finally {
    await browser.close();
  }
}

async function main() {
  await assertFlociUp();
  useLocalEnv();
  const out = readOutputs("ig-local-core");
  await apiFlow(localApiUrl(out.ApiUrl), out.UserPoolClientId);
  await uiFlow();
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
