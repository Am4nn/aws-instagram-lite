"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Post } from "../lib/api";

/** 3-column grid of a user's READY posts (thumbs). */
export function PostGrid({ userId }: { userId: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    api<{ items: Post[] }>(`/users/${userId}/posts`).then((r) => setPosts(r.items)).catch(() => setPosts([]));
  }, [userId]);

  if (posts === null) return <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="tile skeleton" />)}</div>;
  if (posts.length === 0) return <p className="muted">No posts yet.</p>;
  return (
    <div className="grid">
      {posts.map((p) => (
        <Link key={p.postId} href={`/p?id=${p.postId}`} className="tile">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.thumbUrl} alt={p.caption || "photo"} loading="lazy" />
        </Link>
      ))}
    </div>
  );
}
