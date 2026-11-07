"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";

/** "Try again" on a server-rendered error state: renders the page again on the server. */
export function RetryButton({ className = "secondary", children = "Try again" }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={className} disabled={pending} onClick={() => start(() => router.refresh())}>
      {children}
    </button>
  );
}
