"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Camera, Heart, ImageOff, MessageCircle, RotateCw } from "lucide-react";
import { api, type Post } from "../lib/api";
import { EmptyState } from "./ui/EmptyState";
import { Spinner } from "./ui/Spinner";

const fmt = (n: number) => new Intl.NumberFormat("en", { notation: n >= 10000 ? "compact" : "standard" }).format(n);

/**
 * 3-column grid of a user's posts (thumbs). `count` (the profile's postCount) sizes the skeleton
 * so the page doesn't jump when posts arrive; `isMe` adds the "share your first photo" action.
 * `initial`: posts the server already loaded (in the HTML); undefined = load them in the browser.
 */
export function PostGrid({ userId, username, count, isMe = false, initial }: {
  userId: string; username?: string; count?: number; isMe?: boolean; initial?: Post[] | null;
}) {
  const [posts, setPosts] = useState<Post[] | null>(initial ?? null);
  const [failed, setFailed] = useState(initial === null);

  const load = useCallback(() => {
    setFailed(false);
    setPosts(null);
    api<{ items: Post[] }>(`/users/${userId}/posts`)
      .then((r) => setPosts(r.items))
      .catch(() => setFailed(true));
  }, [userId]);

  useEffect(() => {
    if (initial === undefined) load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <div className="grid-msg" role="alert">
        <p className="muted small">Couldn&apos;t load posts.</p>
        <button type="button" className="secondary sm" onClick={load}><RotateCw size={14} aria-hidden /> Retry</button>
      </div>
    );
  }

  if (posts === null) {
    const n = Math.min(Math.max(count ?? 6, 3), 12);
    return (
      <div className="grid" aria-busy="true" aria-label="Loading posts">
        {Array.from({ length: n }, (_, i) => <span key={i} className="tile skeleton" />)}
      </div>
    );
  }

  if (posts.length === 0) {
    return isMe ? (
      <EmptyState icon={Camera} title="Share photos" hint="When you share photos, they'll appear on your profile."
        action={<Link className="btn" href="/new">Share your first photo</Link>} className="grid-empty" />
    ) : (
      <EmptyState icon={Camera} title="No posts yet" className="grid-empty" />
    );
  }

  return (
    <div className="grid">
      {posts.map((p) =>
        p.status === "READY" && p.thumbUrl ? (
          <Link key={p.postId} href={`/p/${p.postId}${username ? `?u=${encodeURIComponent(username)}` : ""}`} className="tile"
            aria-label={`${p.caption || "Photo"} · ${p.likeCount} likes, ${p.commentCount} comments`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumbUrl} alt={p.caption || "photo"} loading="lazy" />
            <span className="tile-overlay" aria-hidden>
              <span><Heart size={19} fill="currentColor" strokeWidth={0} /> {fmt(p.likeCount ?? 0)}</span>
              <span><MessageCircle size={19} fill="currentColor" strokeWidth={0} /> {fmt(p.commentCount ?? 0)}</span>
            </span>
          </Link>
        ) : p.status === "FAILED" ? (
          <div key={p.postId} className="tile tile-state" title={p.failReason ?? "Upload failed"}>
            <ImageOff size={22} strokeWidth={1.6} aria-hidden />
            <span>Failed</span>
          </div>
        ) : (
          <div key={p.postId} className="tile tile-state" title="Processing your photo">
            <Spinner size={20} label="Processing" />
            <span>Processing</span>
          </div>
        ),
      )}
    </div>
  );
}
