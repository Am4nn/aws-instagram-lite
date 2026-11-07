import {
  CognitoIdentityProviderClient, ConfirmSignUpCommand, InitiateAuthCommand, ResendConfirmationCodeCommand,
  RevokeTokenCommand, SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { serverEnv } from "./env";

/**
 * Cognito calls, made by the Next.js server (step 9). The browser never sees a token: the route handlers
 * in app/bff/auth/* put them in httpOnly cookies. These calls need no AWS credentials (public app client).
 */
let client: CognitoIdentityProviderClient | undefined;
function cognito() {
  const env = serverEnv();
  return (client ??= new CognitoIdentityProviderClient({
    region: env.cognitoRegion,
    endpoint: env.cognitoEndpoint,
    credentials: { accessKeyId: "unused", secretAccessKey: "unused" },
  }));
}

export type Tokens = { idToken: string; refreshToken?: string; expiresIn: number };

export async function signIn(username: string, password: string): Promise<Tokens> {
  const r = await cognito().send(new InitiateAuthCommand({
    ClientId: serverEnv().userPoolClientId, AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD: password },
  }));
  const a = r.AuthenticationResult;
  if (!a?.IdToken) throw new Error("Sign-in did not return a token");
  return { idToken: a.IdToken, refreshToken: a.RefreshToken, expiresIn: a.ExpiresIn ?? 3600 };
}

/** Swaps the refresh token (30 days) for a fresh ID token (1 hour). */
export async function refresh(refreshToken: string): Promise<Tokens> {
  const r = await cognito().send(new InitiateAuthCommand({
    ClientId: serverEnv().userPoolClientId, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: refreshToken },
  }));
  const a = r.AuthenticationResult;
  if (!a?.IdToken) throw new Error("Refresh did not return a token");
  return { idToken: a.IdToken, expiresIn: a.ExpiresIn ?? 3600 };
}

/** Sign-out: the refresh token stops working even if someone copied it. Best effort. */
export async function revoke(refreshToken: string): Promise<void> {
  await cognito().send(new RevokeTokenCommand({ ClientId: serverEnv().userPoolClientId, Token: refreshToken })).catch(() => {});
}

/**
 * confirmed = can sign in right away (local: the PreSignUp trigger auto-confirms).
 * Otherwise Cognito emailed a code to `sentTo` (masked, e.g. a***@g***.com).
 */
export async function signUp(username: string, password: string, email?: string): Promise<{ confirmed: boolean; sentTo?: string }> {
  const r = await cognito().send(new SignUpCommand({
    ClientId: serverEnv().userPoolClientId, Username: username, Password: password,
    UserAttributes: email ? [{ Name: "email", Value: email }] : undefined,
  }));
  return { confirmed: r.UserConfirmed !== false, sentTo: r.CodeDeliveryDetails?.Destination };
}

export async function confirmSignUp(username: string, code: string): Promise<void> {
  await cognito().send(new ConfirmSignUpCommand({ ClientId: serverEnv().userPoolClientId, Username: username, ConfirmationCode: code.trim() }));
}

/** Emails a new code; returns the masked address it went to. */
export async function resendCode(username: string): Promise<string | undefined> {
  const r = await cognito().send(new ResendConfirmationCodeCommand({ ClientId: serverEnv().userPoolClientId, Username: username }));
  return r.CodeDeliveryDetails?.Destination;
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
  return "Something went wrong.";
}
