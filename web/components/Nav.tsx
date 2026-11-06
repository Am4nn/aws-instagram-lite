"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { Aperture, Bell, CircleUser, House, LogOut, SquarePlus } from "lucide-react";
import { signOut } from "../lib/auth";
import { api } from "../lib/api";
import { ThemeToggle } from "./ui/ThemeToggle";

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

function logOut() {
  signOut();
  window.location.href = "/login";
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="badge" aria-hidden>{n > 98 ? "99+" : n}</span>;
}

function Item({ path, href, icon: I, label, aria, className = "", badge = 0 }: {
  path: string; href: string; icon: Icon; label: string; aria?: string; className?: string; badge?: number;
}) {
  const active = path === href || path === `${href}/`;
  return (
    <Link
      href={href}
      className={`nav-item ${className}`.trim()}
      aria-current={active ? "page" : undefined}
      aria-label={aria ?? label}
      title={label}
    >
      <span className="nav-icon" aria-hidden>
        <I size={24} strokeWidth={active ? 2.4 : 1.8} />
        <Badge n={badge} />
      </span>
      <span className="nav-label">{label}</span>
    </Link>
  );
}

/**
 * App shell. Render it before <main>: `<Nav />` (fetches the unread count) or `<Nav unread={0} />`.
 * >=768px: fixed icon rail on the left (labels from 1200px). <768px: slim top header + bottom tab bar.
 * globals.css (`body:has(.app-nav)`) pads the page so content never sits under the bars.
 */
export function Nav({ unread: forced }: { unread?: number } = {}) {
  const [unread, setUnread] = useState(forced ?? 0);
  const path = usePathname();

  useEffect(() => {
    if (forced !== undefined) return setUnread(forced);
    api<{ unread: number }>("/notifications").then((r) => setUnread(r.unread)).catch(() => {});
  }, [forced]);

  const activityLabel = unread > 0 ? `Activity (${unread} unread)` : "Activity";

  return (
    <>
      <header className="app-top">
        <Link href="/feed" className="nav-brand" aria-label="Instagram-lite home">
          <Aperture size={22} strokeWidth={2} aria-hidden />
          <span>Instagram-lite</span>
        </Link>
        <span className="nav-spacer" />
        <Link href="/notifications" className="icon-btn" aria-label={activityLabel} title="Activity"
          aria-current={path.startsWith("/notifications") ? "page" : undefined}>
          <span className="nav-icon" aria-hidden>
            <Bell size={22} strokeWidth={1.8} />
            <Badge n={unread} />
          </span>
        </Link>
        <ThemeToggle />
        <button type="button" className="icon-btn" onClick={logOut} aria-label="Log out" title="Log out">
          <LogOut size={20} strokeWidth={1.8} aria-hidden />
        </button>
      </header>

      <nav className="app-nav" aria-label="Main">
        <Link href="/feed" className="nav-brand desk-only" aria-label="Instagram-lite home" title="Instagram-lite">
          <span className="nav-icon" aria-hidden><Aperture size={24} strokeWidth={2} /></span>
          <span className="nav-label">Instagram-lite</span>
        </Link>
        <Item path={path} href="/feed" icon={House} label="Home" />
        <Item path={path} href="/new" icon={SquarePlus} label="New post" />
        <Item path={path} href="/notifications" icon={Bell} label="Activity" aria={activityLabel} badge={unread} className="desk-only" />
        <Item path={path} href="/me" icon={CircleUser} label="Profile" />
        <span className="nav-spacer desk-only" />
        <ThemeToggle size={24} className="nav-item desk-only" label={(name) => <span className="nav-label">Theme: {name}</span>} />
        <button type="button" className="nav-item desk-only" onClick={logOut} aria-label="Log out" title="Log out">
          <span className="nav-icon" aria-hidden><LogOut size={24} strokeWidth={1.8} /></span>
          <span className="nav-label">Log out</span>
        </button>
      </nav>
    </>
  );
}
