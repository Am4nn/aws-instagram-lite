"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; stage: string; time: string };
type State = { kind: "checking" } | { kind: "ok"; health: Health } | { kind: "down" };

const API = process.env.NEXT_PUBLIC_API_URL;

export default function Home() {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    if (!API) return setState({ kind: "down" });
    fetch(`${API}/health`, { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((health: Health) => setState({ kind: "ok", health }))
      .catch(() => setState({ kind: "down" }));
  }, []);

  return (
    <main>
      <h1>Instagram-lite</h1>
      <p className="status" data-state={state.kind}>
        <span className="dot" aria-hidden />
        {state.kind === "checking" && "Checking API…"}
        {state.kind === "ok" &&
          `API ok · stage ${state.health.stage} · ${new Date(state.health.time).toLocaleTimeString()}`}
        {state.kind === "down" && "API unreachable. Is Floci running? (npm run floci:up, then npm run deploy:local)"}
      </p>
      <p className="hint">{API ?? "NEXT_PUBLIC_API_URL not set"}</p>
    </main>
  );
}
