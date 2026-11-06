"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Aperture, Eye, EyeOff } from "lucide-react";
import { authErrorMessage, confirmSignUp, EMAIL_SIGNUP, IS_LOCAL, resendCode, signIn, signUp } from "../../lib/auth";
import { Spinner } from "../../components/ui/Spinner";
import { ThemeToggle } from "../../components/ui/ThemeToggle";

type Health = "checking" | "ok" | "down";
/** "code" = the account exists but Cognito is waiting for the code it emailed (aws stage only). */
type Step = "form" | "code";

export default function Login() {
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
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { signal: AbortSignal.timeout(15000) })
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
        await confirmSignUp(username, code);
      } else if (mode === "up") {
        const r = await signUp(username, password, EMAIL_SIGNUP ? email : undefined);
        if (!r.confirmed) return askForCode(r.sentTo);
      }
      await signIn(username, password);
      // new (or just confirmed) users pick a username first
      window.location.href = mode === "up" || step === "code" ? "/me" : "/feed";
    } catch (err) {
      // Signed up earlier but never typed the code in: send a fresh one and ask for it.
      if ((err as Error)?.name === "UserNotConfirmedException") {
        try {
          return askForCode(await resendCode(username));
        } catch (err2) {
          err = err2;
        }
      }
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    try {
      setSentTo((await resendCode(username)) ?? sentTo);
      setCode("");
    } catch (err) {
      setError(authErrorMessage(err));
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
