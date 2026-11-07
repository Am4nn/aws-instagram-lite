/**
 * Demo data (npm run seed). Log in as any of these with password "password1".
 *   star  : followed by alice, bob, carol, dave → 4 followers ≥ threshold 3 → CELEB (pulled at read time)
 *   bob   : follows alice, carol, dave, star → his feed mixes pushed + pulled posts
 *   eve   : nobody follows her, she follows nobody → her posts appear in no one's feed
 * Photos are real (Unsplash via picsum.photos, credits in photo-credits.json), cached in scripts/.photos.
 * Safe to re-run: sign-up/follow are idempotent and a photo is only posted if that user has no
 * READY post with its caption yet (older demo posts are left alone; new ones land on top).
 * Real AWS (after deploy:aws): npm run seed:aws (= --stage=aws, or IG_STAGE=aws; profile AWS_PROFILE, default ig).
 * There the users are created as admin with a verified placeholder email (<name>@example.com).
 */
import { fileURLToPath } from "node:url";
import { assertFlociUp, scriptStage, useAwsEnv, useLocalEnv } from "./env.js";
import { CREDITS, ensurePhotos, readPhoto } from "./photos.js";
import {
  awsCtx, localCtx, signUpOrIn, ensureProfile, call, uploadPhoto, waitForStatus, type Ctx, type Session,
} from "./client.js";

type Photo = { id: number; caption: string };
/** Photos are posted in this order, so the last one is each user's newest post. */
export const SEED_USERS: { name: string; bio: string; photos: Photo[] }[] = [
  { name: "alice", bio: "Mountains and coffee", photos: [
    { id: 30, caption: "First coffee of the day" },
    { id: 1018, caption: "Took the long way up" },
    { id: 431, caption: "Found a new café near the station" },
    { id: 1015, caption: "Worth every step to get this view" },
    { id: 1036, caption: "Camp at the snow line. Cold night, clear morning" },
  ] },
  { name: "bob", bio: "Testing the feed, mostly from my desk", photos: [
    { id: 0, caption: "New week, same desk" },
    { id: 48, caption: "Late night deploy" },
    { id: 370, caption: "Clean desk, clear head" },
    { id: 180, caption: "Sketching the next feature before coding it" },
  ] },
  { name: "carol", bio: "Street photos", photos: [
    { id: 322, caption: "Cobblestones and quiet" },
    { id: 274, caption: "Times Square never sleeps" },
    { id: 1047, caption: "Back alleys have the best light" },
    { id: 419, caption: "Tram 28, Lisbon" },
    { id: 376, caption: "Yellow cabs everywhere" },
  ] },
  { name: "dave", bio: "Cats, dogs, the odd tiger", photos: [
    { id: 40, caption: "Boop" },
    { id: 237, caption: "Waiting for a treat" },
    { id: 659, caption: "On patrol" },
    { id: 593, caption: "Big cat, still counts" },
    { id: 1025, caption: "Too cold for a walk today" },
  ] },
  { name: "eve", bio: "Nobody follows me yet. Lakes, mostly", photos: [
    { id: 1069, caption: "Aquarium day" },
    { id: 1049, caption: "Still water" },
    { id: 1011, caption: "Paddled out before anyone else was up" },
  ] },
  { name: "star", bio: "Famous here (celeb). Always somewhere new", photos: [
    { id: 1067, caption: "Chicago from above" },
    { id: 49, caption: "Santorini, again" },
    { id: 1039, caption: "Hiked in for this one" },
    { id: 906, caption: "Matterhorn at sunrise" },
    { id: 1040, caption: "Real-life fairytale" },
    { id: 1022, caption: "Northern lights, finally" },
  ] },
];
export const SEED_FOLLOWS: [string, string][] = [
  ["alice", "star"], ["bob", "star"], ["carol", "star"], ["dave", "star"],
  ["bob", "alice"], ["bob", "carol"], ["bob", "dave"], ["alice", "bob"],
];
export const SEED_PHOTO_IDS = SEED_USERS.flatMap((u) => u.photos.map((p) => p.id));

export async function seed(c: Ctx): Promise<Record<string, Session>> {
  const missing = SEED_PHOTO_IDS.filter((id) => !CREDITS.some((cr) => cr.id === id));
  if (missing.length) throw new Error(`photo-credits.json has no entry for ${missing.join(", ")}`);
  await ensurePhotos(SEED_PHOTO_IDS);

  const s: Record<string, Session> = {};
  for (const u of SEED_USERS) s[u.name] = await ensureProfile(c, await signUpOrIn(c, u.name), u.name, u.bio);
  // Follow first, so star is already a celeb when posting (her posts are NOT pushed).
  for (const [a, b] of SEED_FOLLOWS) {
    const r = await call(c, s[a], "POST", `/users/${s[b].userId}/follow`);
    if (r.status !== 200) throw new Error(`follow ${a}→${b}: ${r.status}`);
  }
  for (const u of SEED_USERS) {
    const grid = await call<{ items: { caption: string }[] }>(c, s[u.name], "GET", `/users/${s[u.name].userId}/posts`);
    const posted = new Set((grid.body.items ?? []).map((p) => p.caption));
    for (const photo of u.photos.filter((p) => !posted.has(p.caption))) {
      const id = await uploadPhoto(c, s[u.name], readPhoto(photo.id), photo.caption, "image/jpeg");
      const post = await waitForStatus(c, s[u.name], id);
      if (post.status !== "READY") throw new Error(`${u.name} post ${id} ${post.status}: ${post.failReason}`);
      await new Promise((r) => setTimeout(r, 20)); // distinct createdAt ordering
    }
  }
  return s;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    const stage = scriptStage(process.env, process.argv.slice(2));
    if (stage === "aws") {
      useAwsEnv(); // throws if AWS_ENDPOINT_URL is set
      await seed(awsCtx());
    } else {
      await assertFlociUp();
      useLocalEnv();
      await seed(localCtx());
    }
    console.log(`Seeded ${stage}: ${SEED_USERS.map((u) => u.name).join(", ")} (password: password1). Try logging in as bob.`);
  })().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
