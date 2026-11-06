"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Aperture, Eye, EyeOff } from "lucide-react";
import { authErrorMessage, signIn, signUp } from "../../lib/auth";
import { Spinner } from "../../components/ui/Spinner";
import { ThemeToggle } from "../../components/ui/ThemeToggle";

type Health = "checking" | "ok" | "down";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { signal: AbortSignal.timeout(15000) })
      .then((r) => setHealth(r.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "up") await signUp(username, password);
      await signIn(username, password);
      window.location.href = mode === "up" ? "/me" : "/feed"; // new users pick a username first
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  const action = mode === "in" ? "Log in" : "Create account";
  const healthText = health === "checking" ? "Checking API…" : health === "ok" ? "API online" : "API unreachable — is Floci running and deployed?";

  return (
    <main className="narrow login">
      <div className="login-theme"><ThemeToggle /></div>

      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <Aperture size={36} strokeWidth={1.8} aria-hidden />
          <h1>Instagram-lite</h1>
        </div>
        <h2 className="sr-only">{action}</h2>
        <p className="login-sub muted">{mode === "in" ? "Log in to see photos from people you follow." : "Create an account to start sharing photos."}</p>

        <label>
          <span className="sr-only">Login name</span>
          <input
            value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Login name"
            autoComplete="username" autoCapitalize="none" spellCheck={false} required
          />
        </label>
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

        <p className="error" role="alert">{error}</p>
        <button type="submit" className="block login-submit" disabled={busy} aria-label={busy ? `${action}…` : undefined}>
          {busy ? <Spinner size={16} label={`${action}…`} className="on-accent" /> : action}
        </button>
      </form>

      <p className="login-switch">
        {mode === "in" ? "New here?" : "Have an account?"}{" "}
        <button type="button" className="link" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}>
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
