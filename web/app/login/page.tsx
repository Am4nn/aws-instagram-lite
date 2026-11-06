"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authErrorMessage, signIn, signUp } from "../../lib/auth";

type Health = "checking" | "ok" | "down";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <main>
      <h1>Instagram-lite</h1>
      <form className="card" onSubmit={submit}>
        <h2>{mode === "in" ? "Log in" : "Create account"}</h2>
        <label>
          Login name
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={8} required
          />
        </label>
        <p className="error" role="alert">{error}</p>
        <button type="submit" disabled={busy}>{busy ? "…" : mode === "in" ? "Log in" : "Create account"}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}>
          {mode === "in" ? "New here? Create an account" : "Have an account? Log in"}
        </button>
      </form>
      <p className="status" data-state={health}>
        <span className="dot" aria-hidden />
        {health === "checking" ? "Checking API…" : health === "ok" ? "API ok" : "API unreachable. Is Floci running and deployed?"}
      </p>
    </main>
  );
}
