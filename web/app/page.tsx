"use client";

import { useEffect } from "react";
import { isSignedIn } from "../lib/auth";
import { Spinner } from "../components/ui/Spinner";

/** Entry: signed in → feed, otherwise → login. */
export default function Home() {
  useEffect(() => {
    window.location.replace(isSignedIn() ? "/feed" : "/login");
  }, []);
  return <main className="narrow entry"><Spinner size={22} /></main>;
}
