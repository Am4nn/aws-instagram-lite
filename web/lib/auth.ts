"use client";

import {
  CognitoIdentityProviderClient, ConfirmSignUpCommand, InitiateAuthCommand, ResendConfirmationCodeCommand, SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const CLIENT_ID = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? "";
const KEY = "ig.session";

/** aws stage: the user pool needs an email at sign-up and confirms it with an emailed code. */
export const EMAIL_SIGNUP = process.env.NEXT_PUBLIC_SIGNUP_EMAIL === "required";
/** Local (Floci) build: Cognito runs at a custom endpoint. */
export const IS_LOCAL = !!process.env.NEXT_PUBLIC_COGNITO_ENDPOINT;

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

/**
 * confirmed = can sign in right away (local: the PreSignUp trigger auto-confirms).
 * Otherwise Cognito emailed a code to `sentTo` (masked, e.g. a***@g***.com): call confirmSignUp.
 */
export async function signUp(
  username: string, password: string, email?: string,
): Promise<{ confirmed: boolean; sentTo?: string }> {
  const r = await cognito.send(new SignUpCommand({
    ClientId: CLIENT_ID, Username: username, Password: password,
    UserAttributes: email ? [{ Name: "email", Value: email }] : undefined,
  }));
  return { confirmed: r.UserConfirmed !== false, sentTo: r.CodeDeliveryDetails?.Destination };
}

export async function confirmSignUp(username: string, code: string): Promise<void> {
  await cognito.send(new ConfirmSignUpCommand({ ClientId: CLIENT_ID, Username: username, ConfirmationCode: code.trim() }));
}

/** Emails a new code; returns the masked address it went to. */
export async function resendCode(username: string): Promise<string | undefined> {
  const r = await cognito.send(new ResendConfirmationCodeCommand({ ClientId: CLIENT_ID, Username: username }));
  return r.CodeDeliveryDetails?.Destination;
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
  if (name === "CodeMismatchException") return "That code isn't right. Check the email and try again.";
  if (name === "ExpiredCodeException") return "That code has expired. Send a new one.";
  if (name === "LimitExceededException" || name === "TooManyRequestsException") return "Too many tries. Wait a few minutes.";
  if (name === "CodeDeliveryFailureException") return "We couldn't send the email. Try again later.";
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
