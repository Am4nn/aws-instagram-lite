import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ID_COOKIE } from "./cookies";
import { serverEnv } from "./env";
import { jwtClaims } from "./jwt";

/** Error from the HTTP API (status + its `error` message). */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The signed-in user's ID token from the httpOnly cookie (proxy.ts already refreshed it if needed). */
export async function idToken(): Promise<string | undefined> {
  return (await cookies()).get(ID_COOKIE)?.value;
}

/** My Cognito user id (`sub`), for display decisions only (the API checks the token for real). */
export async function mySub(): Promise<string | null> {
  const t = await idToken();
  return (t && jwtClaims(t)?.sub) || null;
}

/** Raw call to the HTTP API with a Bearer token (used by server components and the /bff/api forwarder). */
export function callApi(path: string, token: string | undefined, init: { method?: string; body?: string } = {}) {
  return fetch(`${serverEnv().apiUrl}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    cache: "no-store",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
}

/**
 * For server components: call the API as the signed-in user and return the JSON body.
 * 401 (token rejected: e.g. Floci was reset) → /login. Other errors throw ApiError.
 */
export async function serverApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await callApi(path, await idToken(), {
    method: init.method, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401) redirect("/login");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** serverApi, but 404 → null (a missing profile/post is a normal state, not an error). */
export async function serverApiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await serverApi<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
