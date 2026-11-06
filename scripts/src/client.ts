/** Small API client used by the seed and smoke scripts (talks to the deployed local stack). */
import {
  CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { readOutputs } from "./deploy-local.js";
import { localApiUrl } from "./urls.js";

export type Ctx = { api: string; clientId: string };
export type Session = { login: string; userId: string; headers: Record<string, string> };

export function localCtx(): Ctx {
  const out = readOutputs("ig-local-core");
  return { api: localApiUrl(out.ApiUrl), clientId: out.UserPoolClientId };
}

/** Sign up (if new) and sign in. Returns auth headers; userId is filled once a profile exists. */
export async function signUpOrIn(c: Ctx, login: string, password = "password1"): Promise<Session> {
  const idp = new CognitoIdentityProviderClient({});
  try {
    await idp.send(new SignUpCommand({ ClientId: c.clientId, Username: login, Password: password }));
  } catch (e) {
    if ((e as Error).name !== "UsernameExistsException") throw e;
  }
  const auth = await idp.send(new InitiateAuthCommand({
    ClientId: c.clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: login, PASSWORD: password },
  }));
  const headers = { authorization: `Bearer ${auth.AuthenticationResult!.IdToken}`, "content-type": "application/json" };
  const me = await fetch(`${c.api}/me`, { headers });
  const userId = me.ok ? (await me.json()).userId : "";
  return { login, userId, headers };
}

export async function call<T = any>(c: Ctx, s: Session | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${c.api}${path}`, {
    method, headers: s?.headers ?? {}, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

export async function ensureProfile(c: Ctx, s: Session, username: string, bio = ""): Promise<Session> {
  const r = await call(c, s, "PUT", "/me", { username, bio });
  if (r.status !== 200) throw new Error(`PUT /me ${r.status} ${JSON.stringify(r.body)}`);
  return { ...s, userId: r.body.userId };
}

/** Create a post, PUT the bytes to the presigned URL, return the postId. */
export async function uploadPhoto(c: Ctx, s: Session, bytes: Buffer, caption: string, contentType = "image/png") {
  const r = await call(c, s, "POST", "/posts", { caption, contentType, size: bytes.length });
  if (r.status !== 201) throw new Error(`POST /posts ${r.status} ${JSON.stringify(r.body)}`);
  const put = await fetch(r.body.uploadUrl, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": contentType } });
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return r.body.postId as string;
}

export async function waitForStatus(c: Ctx, s: Session, postId: string, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { body } = await call(c, s, "GET", `/posts/${postId}`);
    if (body.status && body.status !== "PENDING") return body;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`post ${postId} still PENDING after ${timeoutMs / 1000}s`);
}

/** Polls until `check` passes (eventually-consistent flows like fan-out). */
export async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 30000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last = await fn();
  while (!check(last) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    last = await fn();
  }
  return last;
}
