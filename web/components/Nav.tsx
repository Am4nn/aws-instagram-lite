"use client";

import Link from "next/link";
import { signOut } from "../lib/auth";

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/feed" className="brand">Instagram-lite</Link>
      <span className="spacer" />
      <Link href="/feed">Home</Link>
      <Link href="/new">New post</Link>
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
