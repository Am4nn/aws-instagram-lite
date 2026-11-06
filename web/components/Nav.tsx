"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "../lib/auth";
import { api } from "../lib/api";

/** Top bar. Fetches the unread count unless the page passes one (the notifications page passes 0). */
export function Nav({ unread: forced }: { unread?: number } = {}) {
  const [unread, setUnread] = useState(forced ?? 0);

  useEffect(() => {
    if (forced !== undefined) return;
    api<{ unread: number }>("/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  }, [forced]);

  return (
    <nav className="nav">
      <Link href="/feed" className="brand">Instagram-lite</Link>
      <span className="spacer" />
      <Link href="/feed">Home</Link>
      <Link href="/new">New post</Link>
      <Link href="/notifications" className="bell">
        Activity{unread > 0 && <span className="badge">{unread > 98 ? "99+" : unread}</span>}
      </Link>
      <Link href="/me">Profile</Link>
      <button
        className="link"
        onClick={() => {
          signOut();
          window.location.href = "/login";
        }}
      >
        Log out
      </button>
    </nav>
  );
}
