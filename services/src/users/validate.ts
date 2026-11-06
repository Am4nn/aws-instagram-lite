export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const BIO_MAX = 150;

export type ProfileInput = { username: string; bio: string };
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** "  Alice " and "ALICE" must claim the same name. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateProfileInput(body: unknown): Validation<ProfileInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const { username, bio } = body as Record<string, unknown>;
  const name = typeof username === "string" ? normalizeUsername(username) : "";
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: "username must be 3-20 chars: a-z, 0-9, _" };
  }
  if (bio !== undefined && typeof bio !== "string") return { ok: false, error: "bio must be a string" };
  const cleanBio = (bio ?? "").trim();
  if (cleanBio.length > BIO_MAX) return { ok: false, error: `bio must be at most ${BIO_MAX} chars` };
  return { ok: true, value: { username: name, bio: cleanBio } };
}
