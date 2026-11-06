"use client";

import { useState } from "react";
import { api } from "../lib/api";

/** Optimistic like: flips instantly, then settles on the server's count (or reverts on error). */
export function LikeButton({ postId, liked: initialLiked, count: initialCount }: { postId: string; liked: boolean; count: number }) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !liked;
    setBusy(true);
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const r = await api<{ liked: boolean; likeCount: number }>(`/posts/${postId}/like`, { method: next ? "POST" : "DELETE" });
      setLiked(r.liked);
      setCount(r.likeCount);
    } catch {
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className={`like ${liked ? "on" : ""}`} onClick={toggle} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"}>
      <span aria-hidden>{liked ? "♥" : "♡"}</span> {count}
    </button>
  );
}
