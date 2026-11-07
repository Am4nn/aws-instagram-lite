"use client";

/**
 * Browser → our own Next.js server (BFF). The browser never calls the HTTP API itself and never holds a
 * token: /bff/api/<path> forwards the call with the httpOnly ig_id cookie as the Bearer token.
 * A 401 = the ID token expired: swap the refresh cookie for a new one once and retry, else back to /login.
 */
export * from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const JSON_HEADERS = { "content-type": "application/json" };

/** POST to our auth endpoints. Every mutation is JSON (the CSRF check in proxy.ts insists on it). */
export const bffPost = (path: string, body: unknown = {}) =>
  fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

let refreshing: Promise<boolean> | undefined;
/** One refresh at a time, shared by every request that hit the 401 together. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= bffPost("/bff/auth/refresh").then((r) => r.ok, () => false).finally(() => { refreshing = undefined; });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const send = () => fetch(`/bff/api${path}`, {
    ...init,
    method,
    headers: { ...init.headers, ...(method === "GET" ? {} : JSON_HEADERS) },
    body: method === "GET" ? undefined : (init.body ?? "{}"),
  });
  let res = await send();
  if (res.status === 401 && (await refreshOnce())) res = await send();
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError(401, "session expired");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function signOut(): Promise<void> {
  await bffPost("/bff/auth/signout").catch(() => {});
}
