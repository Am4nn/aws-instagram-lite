"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Aperture, Eye, EyeOff } from "lucide-react";
import { bffPost } from "../../lib/api";
import { Spinner } from "../ui/Spinner";
import { ThemeToggle } from "../ui/ThemeToggle";

type Health = "checking" | "ok" | "down";
/** "code" = the account exists but Cognito is waiting for the code it emailed (aws stage only). */
type Step = "form" | "code";

/** Error from /bff/auth/* with Cognito's exception name (`code`), e.g. UserNotConfirmedException. */
class AuthError extends Error {
  constructor(message: string, public code = "") {
    super(message);
  }
}

/** POST to /bff/auth/<step>. The server talks to Cognito and sets the httpOnly cookies; no token comes back. */
async function auth<T = Record<string, unknown>>(step: string, body: Record<string, string>): Promise<T> {
  const r = await bffPost(`/bff/auth/${step}`, body).catch(() => null);
  const data = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok) throw new AuthError(data.error ?? "Something went wrong.", data.code);
  return data as T;
}

/**
 * Log in / create account. `emailSignup` (aws): sign-up asks for an email and then the emailed code.
 * `isLocal`: Floci hint in the API status line. `next`: where to go after logging in.
 */
export function LoginForm({ emailSignup, isLocal, next }: { emailSignup: boolean; isLocal: boolean; next: string }) {
  const EMAIL_SIGNUP = emailSignup;
  const IS_LOCAL = isLocal;
  const [mode, setMode] = useState<"in" | "up">("in");
  const [step, setStep] = useState<Step>("form");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    fetch("/bff/health", { signal: AbortSignal.timeout(15000) })
      .then((r) => setHealth(r.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  function askForCode(to: string | undefined) {
    setSentTo(to ?? "");
    setCode("");
    setStep("code");
    setBusy(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === "code") {
        await auth("confirm", { username, code, password });
      } else if (mode === "up") {
        const r = await auth<{ confirmed: boolean; sentTo?: string }>("signup", { username, password, ...(EMAIL_SIGNUP ? { email } : {}) });
        if (!r.confirmed) return askForCode(r.sentTo);
      } else {
        await auth("signin", { username, password });
      }
      // new (or just confirmed) users pick a username first
      window.location.href = mode === "up" || step === "code" ? "/me" : next;
    } catch (err) {
      // Signed up earlier but never typed the code in: send a fresh one and ask for it.
      if ((err as AuthError)?.code === "UserNotConfirmedException") {
        try {
          return askForCode((await auth<{ sentTo?: string }>("resend", { username })).sentTo);
        } catch (err2) {
          err = err2;
        }
      }
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    try {
      setSentTo((await auth<{ sentTo?: string }>("resend", { username })).sentTo || sentTo);
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function switchMode() {
    setMode(mode === "in" ? "up" : "in");
    setStep("form");
    setError("");
  }

  const action = step === "code" ? "Confirm" : mode === "in" ? "Log in" : "Create account";
  const sub = step === "code"
    ? `Enter the code we emailed you${sentTo ? ` at ${sentTo}` : ""}.`
    : mode === "in" ? "Log in to see photos from people you follow." : "Create an account to start sharing photos.";
  const healthText = health === "checking" ? "Checking API…" : health === "ok" ? "API online"
    : IS_LOCAL ? "API unreachable — is Floci running and deployed?" : "API unreachable";

  return (
    <main className="narrow login">
      <div className="login-theme"><ThemeToggle /></div>

      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <Aperture size={36} strokeWidth={1.8} aria-hidden />
          <h1>Instagram-lite</h1>
        </div>
        <h2 className="sr-only">{action}</h2>
        <p className="login-sub muted" role={step === "code" ? "status" : undefined}>{sub}</p>

        {step === "code" ? (
          <label>
            <span className="sr-only">Confirmation code</span>
            <input
              value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code"
              autoComplete="one-time-code" inputMode="numeric" maxLength={6} autoFocus required
            />
          </label>
        ) : (
          <>
            <label>
              <span className="sr-only">Login name</span>
              <input
                value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Login name"
                autoComplete="username" autoCapitalize="none" spellCheck={false} required
              />
            </label>
            {mode === "up" && EMAIL_SIGNUP && (
              <label>
                <span className="sr-only">Email</span>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
                  autoComplete="email" autoCapitalize="none" spellCheck={false} required
                />
              </label>
            )}
            <label className="login-pw">
              <span className="sr-only">Password</span>
              <input
                type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
                autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={8} required
              />
              <button
                type="button" className="icon-btn login-eye" onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? "Hide password" : "Show password"} title={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
              >
                {showPw ? <EyeOff size={18} strokeWidth={1.8} aria-hidden /> : <Eye size={18} strokeWidth={1.8} aria-hidden />}
              </button>
            </label>
          </>
        )}

        <p className="error" role="alert">{error}</p>
        <button type="submit" className="block login-submit" disabled={busy} aria-label={busy ? `${action}…` : undefined}>
          {busy ? <Spinner size={16} label={`${action}…`} className="on-accent" /> : action}
        </button>
        {step === "code" && (
          <p className="login-resend muted">
            No email? Check spam, or{" "}
            <button type="button" className="link" onClick={resend}>resend the code</button>
          </p>
        )}
      </form>

      <p className="login-switch">
        {mode === "in" ? "New here?" : "Have an account?"}{" "}
        <button type="button" className="link" onClick={switchMode}>
          {mode === "in" ? "Create an account" : "Log in"}
        </button>
      </p>

      <p className="status xs" data-state={health} title={healthText}>
        <span className="dot" aria-hidden />
        {healthText}
      </p>
    </main>
  );
}
