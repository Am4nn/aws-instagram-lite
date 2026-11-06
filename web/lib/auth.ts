"use client";

import {
  CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const CLIENT_ID = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? "";
const KEY = "ig.session";

// SignUp / InitiateAuth need no AWS credentials; endpoint = Floci locally, real Cognito on AWS.
const cognito = new CognitoIdentityProviderClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? "us-east-1",
  endpoint: process.env.NEXT_PUBLIC_COGNITO_ENDPOINT || undefined,
  credentials: { accessKeyId: "unused", secretAccessKey: "unused" },
});

type Session = { idToken: string; refreshToken?: string; expiresAt: number };

function save(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function load(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

export async function signUp(username: string, password: string): Promise<void> {
  await cognito.send(new SignUpCommand({ ClientId: CLIENT_ID, Username: username, Password: password }));
}

export async function signIn(username: string, password: string): Promise<void> {
  const r = await cognito.send(new InitiateAuthCommand({
    ClientId: CLIENT_ID, AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD: password },
  }));
  const a = r.AuthenticationResult;
  if (!a?.IdToken) throw new Error("Sign-in did not return a token");
  save({ idToken: a.IdToken, refreshToken: a.RefreshToken, expiresAt: Date.now() + (a.ExpiresIn ?? 3600) * 1000 });
}

/** Swaps the refresh token for a fresh ID token (refresh tokens live ~30 days, ID tokens 1 hour). */
async function refresh(s: Session): Promise<Session | null> {
  if (!s.refreshToken) return null;
  try {
    const r = await cognito.send(new InitiateAuthCommand({
      ClientId: CLIENT_ID, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: s.refreshToken },
    }));
    const a = r.AuthenticationResult;
    if (!a?.IdToken) return null;
    const next = { idToken: a.IdToken, refreshToken: s.refreshToken, expiresAt: Date.now() + (a.ExpiresIn ?? 3600) * 1000 };
    save(next);
    return next;
  } catch {
    return null;
  }
}

/** A valid ID token, refreshing if it expires within a minute; null = must log in. */
export async function getIdToken(): Promise<string | null> {
  const s = load();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.idToken;
  const next = await refresh(s);
  if (!next) signOut();
  return next?.idToken ?? null;
}

export function signOut(): void {
  localStorage.removeItem(KEY);
}

export function isSignedIn(): boolean {
  return load() !== null;
}

/** Readable message from Cognito errors (e.g. UsernameExistsException). */
export function authErrorMessage(e: unknown): string {
  const name = (e as Error)?.name ?? "";
  if (name === "UsernameExistsException") return "That login name is already registered.";
  if (name === "NotAuthorizedException") return "Wrong login name or password.";
  if (name === "UserNotFoundException") return "No account with that login name.";
  if (name === "InvalidPasswordException") return "Password must be at least 8 characters.";
  return (e as Error)?.message || "Something went wrong.";
}

/** My Cognito user id (`sub`), read from the stored ID token (display only; the API re-checks it). */
export function mySub(): string | null {
  const s = load();
  if (!s) return null;
  try {
    return JSON.parse(atob(s.idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub ?? null;
  } catch {
    return null;
  }
}
