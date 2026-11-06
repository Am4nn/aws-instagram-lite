/**
 * End-to-end checks against Floci (npm run smoke). Each section prints ✅ lines.
 *  auth:     sign up → GET /me 404 → PUT /me → GET /users/{NAME} → no token 401
 *  pipeline: POST /posts → PUT PNG to S3 → READY → in grid, postCount 1; a fake PNG → FAILED
 *  feed:     seeds demo users; bob's feed = pushed + celeb-pulled posts, paged, unfollow/refollow
 *  ui:       (needs `npm -w web run dev`) create account → username → upload via /new → grid shows it
 */
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import puppeteer from "puppeteer-core";
import { assertFlociUp, useLocalEnv } from "./env.js";
import { readOutputs } from "./deploy-local.js";
import { localApiUrl } from "./urls.js";
import { makePng } from "./png.js";
import { seed } from "./seed.js";
import { call, eventually, type Session } from "./client.js";

const WEB = "http://localhost:3000";
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
const img = (name: string) => fileURLToPath(new URL(`../../docs/learn/img/${name}`, import.meta.url));

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`✅ ${msg}`);
}

type Ctx = { api: string; clientId: string };
type User = { login: string; userId: string; headers: Record<string, string> };

async function newUser(c: Ctx, withProfile = true): Promise<User> {
  const idp = new CognitoIdentityProviderClient({});
  const login = `smoke${randomUUID().slice(0, 6)}`;
  await idp.send(new SignUpCommand({ ClientId: c.clientId, Username: login, Password: "password1" }));
  const auth = await idp.send(new InitiateAuthCommand({
    ClientId: c.clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: login, PASSWORD: "password1" },
  }));
  const headers = { authorization: `Bearer ${auth.AuthenticationResult!.IdToken}`, "content-type": "application/json" };
  let userId = "";
  if (withProfile) {
    const r = await fetch(`${c.api}/me`, { method: "PUT", headers, body: JSON.stringify({ username: login }) });
    userId = (await r.json()).userId;
  }
  return { login, userId, headers };
}

async function waitForStatus(c: Ctx, u: User, postId: string, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const post = await fetch(`${c.api}/posts/${postId}`, { headers: u.headers }).then((r) => r.json());
    if (post.status !== "PENDING") return post;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`post ${postId} still PENDING after ${timeoutMs / 1000}s`);
}

async function authFlow(c: Ctx) {
  const u = await newUser(c, false);
  ok((await fetch(`${c.api}/me`, { headers: u.headers })).status === 404, "auth: GET /me before profile → 404");
  const put = await fetch(`${c.api}/me`, { method: "PUT", headers: u.headers, body: JSON.stringify({ username: u.login, bio: "smoke" }) });
  ok(put.status === 200, "auth: PUT /me → 200");
  const got = await fetch(`${c.api}/users/${u.login.toUpperCase()}`, { headers: u.headers }).then((r) => r.json());
  ok(got.username === u.login, "auth: GET /users/{NAME} is case-insensitive");
  ok((await fetch(`${c.api}/me`)).status === 401, "auth: no token → 401");
}

async function upload(c: Ctx, u: User, body: Buffer, caption: string) {
  const r = await fetch(`${c.api}/posts`, { method: "POST", headers: u.headers, body: JSON.stringify({ caption, contentType: "image/png", size: body.length }) });
  const { postId, uploadUrl } = await r.json();
  const put = await fetch(uploadUrl, { method: "PUT", body: new Uint8Array(body), headers: { "content-type": "image/png" } });
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return postId as string;
}

async function pipelineFlow(c: Ctx) {
  const u = await newUser(c);
  const t0 = Date.now();
  const good = await waitForStatus(c, u, await upload(c, u, makePng(1600, 900), "smoke photo"));
  ok(good.status === "READY" && good.thumbUrl && good.fullUrl, `pipeline: real PNG → READY in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  ok((await fetch(good.thumbUrl)).ok, "pipeline: thumb URL serves the resized image");
  const grid = await fetch(`${c.api}/users/${u.userId}/posts`, { headers: u.headers }).then((r) => r.json());
  ok(grid.items.length === 1 && grid.items[0].postId === good.postId, "pipeline: post appears in the profile grid");
  const me = await fetch(`${c.api}/me`, { headers: u.headers }).then((r) => r.json());
  ok(me.postCount === 1, "pipeline: postCount = 1");
  const bad = await waitForStatus(c, u, await upload(c, u, Buffer.from("definitely not a png"), "fake"));
  ok(bad.status === "FAILED", `pipeline: fake PNG → FAILED (${bad.failReason})`);
  const grid2 = await fetch(`${c.api}/users/${u.userId}/posts`, { headers: u.headers }).then((r) => r.json());
  ok(grid2.items.length === 1, "pipeline: FAILED post stays out of the grid");
}

async function uiFlow() {
  if (!CHROME) return console.log("⚠️  ui: no Chrome/Edge found, skipped");
  if (!(await fetch(WEB).then(() => true, () => false))) {
    return console.log("⚠️  ui: web dev server not running (npm -w web run dev), skipped");
  }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 900 });
    const login = `ui${randomUUID().slice(0, 6)}`;
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await page.click("button.link");
    await page.type('input[autocomplete="username"]', login);
    await page.type('input[type="password"]', "password1");
    await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.click('button[type="submit"]')]);
    ok(page.url().endsWith("/me"), "ui: create account lands on /me");
    await page.waitForSelector("form.card h2", { timeout: 20000 });
    ok((await page.$eval("form.card h2", (el) => el.textContent)) === "Choose a username", "ui: asks for a username");
    await page.type("form.card input", login);
    await page.click('form.card button[type="submit"]');
    await page.waitForSelector(".profile h1", { timeout: 20000 });
    ok((await page.$eval(".profile h1", (el) => el.textContent)) === `@${login}`, "ui: profile shows the username");
    await page.screenshot({ path: img("02-profile.png") });

    const file = join(mkdtempSync(join(tmpdir(), "ig-")), "photo.png");
    writeFileSync(file, makePng(1200, 1200, [214, 120, 60]));
    await page.goto(`${WEB}/new`, { waitUntil: "networkidle0" });
    const input = await page.$('input[type="file"]');
    await input!.uploadFile(file);
    await page.type("textarea", "uploaded by the smoke test");
    await Promise.all([page.waitForNavigation({ timeout: 90000 }), page.click('button[type="submit"]')]);
    await page.waitForSelector(".grid .tile img", { timeout: 20000 });
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>(".grid .tile img");
      return img?.complete && img.naturalWidth > 0;
    }, { timeout: 20000 });
    ok(true, "ui: upload via /new → back on /me with the photo in the grid");
    await page.screenshot({ path: img("03-grid.png") });

    // Seeded user's home feed (run `npm run seed` first; skipped if bob doesn't exist)
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await page.type('input[autocomplete="username"]', "bob");
    await page.type('input[type="password"]', "password1");
    await page.click('button[type="submit"]');
    const landed = await page.waitForSelector(".feed-card img", { timeout: 20000 }).then(() => true, () => false);
    if (landed) {
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".feed-card img")].slice(0, 2)
        .every((i) => i.complete && i.naturalWidth > 0), { timeout: 20000 });
      ok(true, "ui: bob's home feed renders posts");
      await page.screenshot({ path: img("04-feed.png") });
    } else console.log("⚠️  ui: no feed for bob (run npm run seed), skipped");
  } finally {
    await browser.close();
  }
}

type FeedPage = { items: { postId: string; author: { username: string } }[]; next?: string };

async function readWholeFeed(c: Ctx, s: Session) {
  const pages: FeedPage[] = [];
  let cursor: string | undefined;
  do {
    const r = await call<FeedPage>(c, s, "GET", `/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (r.status !== 200) throw new Error(`GET /feed ${r.status}`);
    pages.push(r.body);
    cursor = r.body.next;
  } while (cursor && pages.length < 10);
  return pages;
}
const authorsOf = (pages: FeedPage[]) => new Set(pages.flatMap((p) => p.items.map((i) => i.author.username)));

async function feedFlow(c: Ctx) {
  const s = await seed(c); // idempotent
  const bob = s.bob;
  // Fan-out is asynchronous (EventBridge → SQS → Lambda), so wait until it has caught up.
  const pages = await eventually(() => readWholeFeed(c, bob), (p) => p.flatMap((x) => x.items).length >= 11, 45000);
  const authors = authorsOf(pages);
  ok(["alice", "carol", "dave", "bob"].every((a) => authors.has(a)), "feed: pushed posts from people bob follows (+ his own)");
  ok(authors.has("star"), "feed: celeb (star) posts pulled at read time");
  ok(!authors.has("eve"), "feed: nothing from eve (not followed)");
  const ids = pages.flatMap((p) => p.items.map((i) => i.postId));
  ok(pages.length >= 2 && new Set(ids).size === ids.length, `feed: ${pages.length} pages via cursor, no duplicates`);
  const forged = (pages[0].next ?? "x.y").replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
  ok((await call(c, bob, "GET", `/feed?cursor=${encodeURIComponent(forged)}`)).status === 400, "feed: tampered cursor → 400");
  await call(c, bob, "DELETE", `/users/${s.alice.userId}/follow`);
  ok(!authorsOf(await readWholeFeed(c, bob)).has("alice"), "feed: unfollow alice → her posts disappear at once");
  await call(c, bob, "POST", `/users/${s.alice.userId}/follow`);
  ok(authorsOf(await readWholeFeed(c, bob)).has("alice"), "feed: follow again → her posts are back");
  const star = await call(c, bob, "GET", "/users/star");
  ok(star.body.isFollowing === true && star.body.followerCount >= 3, "feed: profile shows isFollowing + star is a celeb (≥3 followers)");
}

async function main() {
  await assertFlociUp();
  useLocalEnv();
  const out = readOutputs("ig-local-core");
  const c: Ctx = { api: localApiUrl(out.ApiUrl), clientId: out.UserPoolClientId };
  const only = process.argv[2];
  if (!only || only === "auth") await authFlow(c);
  if (!only || only === "pipeline") await pipelineFlow(c);
  if (!only || only === "feed") await feedFlow(c);
  if (!only || only === "ui") await uiFlow();
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
