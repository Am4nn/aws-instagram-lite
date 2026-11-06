"use client";

import { useEffect } from "react";
import { isSignedIn } from "../lib/auth";

/** Entry: signed in → feed, otherwise → login. */
export default function Home() {
  useEffect(() => {
    window.location.replace(isSignedIn() ? "/feed" : "/login");
  }, []);
  return <main><p className="muted">Loading…</p></main>;
}
