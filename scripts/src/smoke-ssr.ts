/**
 * `npm run smoke ssr` (after deploy:web): the step 9 site through Floci's CloudFront, with plain HTTP
 * (a tiny cookie jar, no browser): server-rendered HTML, cookie flags, CSRF, BFF actions, origin secret.
 */
import { randomUUID } from "node:crypto";
import { makePng } from "./png.js";
import { SEED_FOLLOWS, SEED_USERS } from "./seed.js";
import { eventually } from "./client.js";

type Ok = (cond: unknown, msg: string) => void;

/** Cookies as a browser keeps them: by name, sent only under their Path. */
export class Jar {
  private c = new Map<string, { value: string; path: string }>();
  raw: string[] = [];
  store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      this.raw.push(line);
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      const path = attrs.find((a) => /^path=/i.test(a))?.slice(5) ?? "/";
      const gone = attrs.some((a) => /^max-age=0$/i.test(a)) || value === "";
      if (gone) this.c.delete(name);
      else this.c.set(name, { value, path });
    }
  }
  header(path: string) {
    return [...this.c].filter(([, v]) => path.startsWith(v.path)).map(([k, v]) => `${k}=${v.value}`).join("; ");
  }
  has(name: string) { return this.c.has(name); }
}

export async function ssrFlow(o: { base: string; functionUrl: string; ok: Ok }) {
  const { base } = o;
  const ok: Ok = o.ok;
  const get = (jar: Jar | null, path: string) => fetch(`${base}${path}`, {
    redirect: "manual", headers: jar ? { cookie: jar.header(path.split("?")[0]) } : {},
  }).then((r) => { jar?.store(r); return r; });
  const send = (jar: Jar | null, method: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method, redirect: "manual", body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { origin: base, "content-type": "application/json", ...(jar ? { cookie: jar.header(path) } : {}), ...headers },
    }).then((r) => { jar?.store(r); return r; });
  /** Follow redirects like a browser (relative Location), return the final path. */
  async function land(jar: Jar | null, path: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const r = await get(jar, path);
      if (r.status < 300 || r.status >= 400) return path;
      path = new URL(r.headers.get("location")!, `${base}${path}`).pathname;
    }
    throw new Error("redirect loop");
  }

  // ---------- pages + login ----------
  const login = await get(null, "/login");
  ok(login.status === 200 && (await login.text()).includes("Instagram-lite"), "ssr: /login rendered by the server Lambda through CloudFront");
  ok((await land(new Jar(), "/feed")) === "/login", "ssr: logged out, /feed → /bff/auth/refresh → /login");

  const creds = { username: "bob", password: "password1" };
  ok((await send(null, "POST", "/bff/auth/signin", creds, { origin: "https://evil.example.com" })).status === 403, "ssr: sign-in from another Origin → 403 (CSRF)");
  const noOrigin = await fetch(`${base}/bff/auth/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  ok(noOrigin.status === 403, "ssr: sign-in without an Origin header → 403");
  ok((await send(null, "POST", "/bff/auth/signin", "username=bob&password=password1", { "content-type": "application/x-www-form-urlencoded" })).status === 415,
    "ssr: form-encoded POST (what a cross-site <form> sends) → 415");

  const bob = new Jar();
  const si = await send(bob, "POST", "/bff/auth/signin", creds);
  const siBody = await si.text();
  ok(si.status === 200 && !/eyJ/.test(siBody), "ssr: sign-in → 200 and the response body carries no token");
  const id = bob.raw.find((l) => l.startsWith("ig_id="))!;
  const refresh = bob.raw.find((l) => l.startsWith("ig_refresh="))!;
  ok(/HttpOnly/i.test(id) && /SameSite=lax/i.test(id) && /Path=\//.test(id) && /Max-Age=\d+/.test(id) && !/Secure/i.test(id),
    "ssr: ig_id cookie is HttpOnly, SameSite=Lax, Path=/, Max-Age, not Secure on http (JS can't read it)");
  ok(/HttpOnly/i.test(refresh) && /Path=\/bff\/auth/.test(refresh) && /Max-Age=2592000/.test(refresh),
    "ssr: ig_refresh cookie is HttpOnly, Path=/bff/auth, 30 days");

  const feed = await get(bob, "/feed");
  const html = await feed.text();
  const followed = new Set(SEED_FOLLOWS.filter(([a]) => a === "bob").map(([, b]) => b).concat("bob"));
  const captions = SEED_USERS.filter((u) => followed.has(u.name)).flatMap((u) => u.photos.map((p) => p.caption));
  const found = captions.find((c) => html.includes(c.replace(/'/g, "&#x27;")));
  ok(feed.status === 200 && found, `ssr: raw HTML of /feed for bob already contains a seeded caption ("${found}")`);
  ok(!html.includes("X-Amz-Signature") && html.includes('src="/media/'), "ssr: photos are same-site /media/... URLs (no presigned links)");
  const media = /src="(\/media\/[^"]+)"/.exec(html)![1];
  const img = await fetch(`${base}${media}`);
  ok(img.status === 200 && img.headers.get("content-type") === "image/jpeg", "ssr: /media/* served from the media bucket by CloudFront");
  const chunk = /"(\/_next\/static\/[^"]+\.js)"/.exec(html)![1];
  ok((await fetch(`${base}${chunk}`)).headers.get("cache-control")?.includes("immutable"), "ssr: /_next/static/* served from S3, cached as immutable");

  const page = await (await get(bob, "/bff/api/feed")).json();
  const more = await get(bob, `/bff/api/feed?cursor=${encodeURIComponent(page.next)}`);
  const page2 = await more.json();
  ok(more.status === 200 && page2.items.length > 0 && page2.items[0].postId !== page.items[0].postId,
    "ssr: load more via /bff/api/feed?cursor= (query string reaches the server)");

  // ---------- a fresh author: sign up, username, upload ----------
  const author = new Jar();
  const name = `ssr${randomUUID().slice(0, 6)}`;
  const su = await send(author, "POST", "/bff/auth/signup", { username: name, password: "password1" });
  ok(su.status === 200 && (await su.json()).confirmed === true && author.has("ig_id"), "ssr: sign-up (auto-confirmed locally) signs in with cookies");
  const me = await (await send(author, "PUT", "/bff/api/me", { username: name })).json();
  ok(me.username === name, "ssr: PUT /bff/api/me picks a username");
  const png = makePng(900, 900, [120, 90, 200]);
  const created = await (await send(author, "POST", "/bff/api/posts", { caption: "ssr smoke photo", contentType: "image/png", size: png.length })).json();
  const put = await fetch(created.uploadUrl, { method: "PUT", body: new Uint8Array(png), headers: { "content-type": "image/png" } });
  ok(put.ok, "ssr: create post via BFF → presigned PUT straight to S3");
  const post = await eventually(() => get(author, `/bff/api/posts/${created.postId}`).then((r) => r.json()), (p) => p.status !== "PENDING", 60000);
  ok(post.status === "READY" && post.thumbUrl === `/media/${created.postId}/thumb.jpg`, "ssr: pipeline → READY with /media thumb URL");
  ok((await fetch(`${base}${post.thumbUrl}`)).ok, "ssr: the new thumbnail loads through CloudFront");

  // ---------- bob likes, comments, follows ----------
  const like = await (await send(bob, "POST", `/bff/api/posts/${created.postId}/like`)).json();
  ok(like.liked === true && like.likeCount === 1, "ssr: like via /bff/api");
  const cm = await send(bob, "POST", `/bff/api/posts/${created.postId}/comments`, { text: "server-rendered!" });
  ok(cm.status === 201, "ssr: comment via /bff/api");
  ok((await send(bob, "POST", `/bff/api/users/${me.userId}/follow`)).status === 200, "ssr: follow via /bff/api");
  ok((await send(bob, "DELETE", `/bff/api/posts/${created.postId}/like`, {}, { origin: "https://evil.example.com" })).status === 403,
    "ssr: cross-site unlike → 403");
  ok((await send(bob, "PUT", `/bff/api/posts/${created.postId}`)).status === 404, "ssr: a route outside the BFF allowlist → 404");

  const postHtml = await (await get(bob, `/p/${created.postId}?u=${name}`)).text();
  ok(postHtml.includes("server-rendered!") && postHtml.includes("ssr smoke photo"), "ssr: /p/[id] HTML has the caption and the comment");
  const userHtml = await (await get(bob, `/u/${name}`)).text();
  ok(userHtml.includes(`@${name}`) && userHtml.includes("Following"), "ssr: /u/[name] HTML shows the profile, already followed");
  const old = await get(bob, "/u?name=star");
  ok(old.status === 307 && old.headers.get("location")?.endsWith("/u/star"), "ssr: old /u?name=star link redirects to /u/star");

  const notifs = await eventually(() => get(author, "/notifications").then((r) => r.text()),
    (h) => h.includes("liked your photo") && h.includes("commented:") && h.includes("started following you"), 45000);
  ok(notifs.includes("bob"), "ssr: author's /notifications HTML lists bob's like, comment and follow");

  // ---------- refresh, sign-out, origin secret ----------
  const before = bob.header("/");
  const rf = await send(bob, "POST", "/bff/auth/refresh");
  ok(rf.status === 200 && bob.has("ig_id") && bob.header("/") !== before, "ssr: POST /bff/auth/refresh swaps the refresh cookie for a new ig_id");
  await send(bob, "POST", "/bff/auth/signout");
  ok(!bob.has("ig_id") && !bob.has("ig_refresh"), "ssr: sign-out expires both cookies");
  ok((await land(bob, "/feed")) === "/login", "ssr: after sign-out /feed goes to /login");

  const direct = o.functionUrl.replace(/\/$/, "");
  ok((await fetch(`${direct}/login`)).status === 403, "ssr: Function URL hit directly (no x-origin-verify) → 403");
  ok((await fetch(`${direct}/login`, { headers: { "x-origin-verify": "guess" } })).status === 403, "ssr: Function URL with a wrong secret → 403");
}
