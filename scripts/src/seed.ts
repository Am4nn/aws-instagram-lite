/**
 * Demo data (npm run seed). Log in as any of these with password "password1".
 *   star  : followed by alice, bob, carol, dave → 4 followers ≥ threshold 3 → CELEB (pulled at read time)
 *   bob   : follows alice, carol, dave, star → his feed mixes pushed + pulled posts
 *   eve   : nobody follows her, she follows nobody → her posts appear in no one's feed
 * Safe to re-run: sign-up/follow are idempotent and posts are only created for users with none.
 */
import { fileURLToPath } from "node:url";
import { assertFlociUp, useLocalEnv } from "./env.js";
import { makePng } from "./png.js";
import {
  localCtx, signUpOrIn, ensureProfile, call, uploadPhoto, waitForStatus, type Ctx, type Session,
} from "./client.js";

type Rgb = [number, number, number];
export const SEED_USERS: { name: string; bio: string; color: Rgb; posts: number }[] = [
  { name: "alice", bio: "Mountains and coffee", color: [196, 98, 74], posts: 2 },
  { name: "bob", bio: "Testing the feed", color: [74, 128, 196], posts: 2 },
  { name: "carol", bio: "Street photos", color: [92, 160, 110], posts: 2 },
  { name: "dave", bio: "Cats, mostly", color: [180, 150, 70], posts: 2 },
  { name: "eve", bio: "Nobody follows me yet", color: [150, 90, 170], posts: 2 },
  { name: "star", bio: "Famous here (celeb)", color: [220, 180, 60], posts: 3 },
];
export const SEED_FOLLOWS: [string, string][] = [
  ["alice", "star"], ["bob", "star"], ["carol", "star"], ["dave", "star"],
  ["bob", "alice"], ["bob", "carol"], ["bob", "dave"], ["alice", "bob"],
];

export async function seed(c: Ctx): Promise<Record<string, Session>> {
  const s: Record<string, Session> = {};
  for (const u of SEED_USERS) s[u.name] = await ensureProfile(c, await signUpOrIn(c, u.name), u.name, u.bio);
  // Follow first, so star is already a celeb when posting (her posts are NOT pushed).
  for (const [a, b] of SEED_FOLLOWS) {
    const r = await call(c, s[a], "POST", `/users/${s[b].userId}/follow`);
    if (r.status !== 200) throw new Error(`follow ${a}→${b}: ${r.status}`);
  }
  for (const u of SEED_USERS) {
    const me = await call(c, s[u.name], "GET", "/me");
    for (let i = me.body.postCount ?? 0; i < u.posts; i++) {
      const shade = u.color.map((v) => Math.max(0, v - i * 40)) as Rgb;
      const id = await uploadPhoto(c, s[u.name], makePng(1080, 1080, shade), `${u.name}'s photo #${i + 1}`);
      const post = await waitForStatus(c, s[u.name], id);
      if (post.status !== "READY") throw new Error(`${u.name} post ${id} ${post.status}: ${post.failReason}`);
      await new Promise((r) => setTimeout(r, 20)); // distinct createdAt ordering
    }
  }
  return s;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    await assertFlociUp();
    useLocalEnv();
    await seed(localCtx());
    console.log(`Seeded: ${SEED_USERS.map((u) => u.name).join(", ")} (password: password1). Try logging in as bob.`);
  })().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
