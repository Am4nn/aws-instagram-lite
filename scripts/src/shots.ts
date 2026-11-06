// Screenshots for UI work: logs in, then shoots each route at desktop + phone width, light + dark.
//
//   npx tsx scripts/src/shots.ts                 # default routes (see DEFAULT_ROUTES)
//   npx tsx scripts/src/shots.ts /feed /me       # just these
//   npx tsx scripts/src/shots.ts post            # "post" = first post page linked from the feed
//   npx tsx scripts/src/shots.ts /feed --full    # full-page instead of viewport-only
//   npx tsx scripts/src/shots.ts /me --light     # only one theme (--light / --dark), --desktop / --phone for one width
//
// Env: WEB (default http://localhost:3000), SHOTS_DIR (default: the session scratchpad shots/ folder),
//      SHOTS_USER / SHOTS_PASS (default bob / password1), SHOTS_DEBUG=1 prints per-shot timings.
// Output: <SHOTS_DIR>/<route-slug>-<width>-<theme>.png, e.g. feed-1280-dark.png, u-name-star-390-light.png, post-390-dark.png
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const OUT = process.env.SHOTS_DIR
  ?? "C:/Users/125ar/AppData/Local/Temp/claude/117dc4c49168f9b1/ddabb66a-cd50-490d-9395-0b952876e650/scratchpad/shots";
const USER = process.env.SHOTS_USER ?? "bob";
const PASS = process.env.SHOTS_PASS ?? "password1";
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

const DEFAULT_ROUTES = ["/feed", "/me", "/new", "/notifications", "/u?name=star", "/login", "post"];
const SIZES = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
] as const;
const THEMES = ["light", "dark"] as const;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
// Git Bash rewrites "/feed" to "C:/Program Files/Git/feed"; undo that.
const routes = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.replace(/\\/g, "/").replace(/^[A-Za-z]:\/.*?\/Git(?=\/)/, ""));
const themes = THEMES.filter((t) => !(flags.has("--light") || flags.has("--dark")) || flags.has(`--${t}`));
const sizes = SIZES.filter((s) => !(flags.has("--desktop") || flags.has("--phone")) || flags.has(`--${s.name}`));
const fullPage = flags.has("--full");

/** "/u?name=star" -> "u-name-star", "/" -> "root", "/p?id=abc" -> "post" */
function slug(route: string): string {
  if (route.startsWith("/p?")) return "post";
  const s = route.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "root";
}

/** Network quiet, fonts ready, every image in the viewport decoded, transitions done. */
async function settle(page: Page) {
  // goto(..., networkidle0) already waited for the network. (page.waitForNetworkIdle would hang here:
  // the Next dev server keeps a long-lived request open.)
  // Hide the Next.js dev indicator ("N" bubble) so it doesn't cover the sidebar in shots.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page
    .waitForFunction(
      () =>
        [...document.images]
          .filter((i) => {
            const r = i.getBoundingClientRect();
            return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
          })
          .every((i) => i.complete),
      { timeout: 10000 },
    )
    .catch(() => console.log("   (some images still loading)"));
  await new Promise((r) => setTimeout(r, 350));
}

async function logIn(page: Page) {
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
  await page.type('input[autocomplete="username"]', USER);
  await page.type('input[type="password"]', PASS);
  await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.click('button[type="submit"]')]);
  if (!page.url().includes("/feed")) throw new Error(`login as ${USER} landed on ${page.url()}`);
}

async function firstPostRoute(page: Page): Promise<string | null> {
  await page.goto(`${WEB}/feed`, { waitUntil: "networkidle0" });
  const href = await page
    .waitForSelector(".feed-card a[href^='/p?id=']:not(.author)", { timeout: 15000 })
    .then((el) => el?.evaluate((a) => a.getAttribute("href")) ?? null)
    .catch(() => null);
  return href;
}

async function main() {
  if (!CHROME) throw new Error("No Chrome/Edge found");
  if (!(await fetch(WEB).then(() => true, () => false))) throw new Error(`Web dev server not reachable at ${WEB}`);
  mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await logIn(page);
    // Follow the system theme; we flip it with emulateMediaFeatures below.
    await page.evaluate(() => localStorage.removeItem("theme"));

    const wanted = routes.length ? routes : DEFAULT_ROUTES;
    const list: string[] = [];
    for (const r of wanted) {
      if (r !== "post") list.push(r);
      else {
        const p = await firstPostRoute(page);
        if (p) list.push(p);
        else console.log("⚠️  no post link found in the feed, skipping post page");
      }
    }

    const written: string[] = [];
    for (const size of sizes) {
      await page.setViewport({ width: size.width, height: size.height, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 1 });
      for (const theme of themes) {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
        for (const route of list) {
          const t0 = Date.now();
          await page.goto(`${WEB}${route}`, { waitUntil: "networkidle0", timeout: 30000 }).catch(() => {});
          const t1 = Date.now();
          await settle(page);
          if (process.env.SHOTS_DEBUG) console.log(`   goto ${t1 - t0}ms, settle ${Date.now() - t1}ms`);
          const file = join(OUT, `${slug(route)}-${size.width}-${theme}.png`);
          await page.screenshot({ path: file as `${string}.png`, fullPage });
          written.push(file);
          console.log(`📸 ${route} ${size.width} ${theme}`);
        }
      }
    }
    console.log(`\n${written.length} screenshots in ${OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
