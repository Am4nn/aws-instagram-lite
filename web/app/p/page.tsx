"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Post } from "../../lib/api";

function PostView() {
  const id = useSearchParams().get("id") ?? "";
  const [post, setPost] = useState<Post | null | undefined>(undefined);

  useEffect(() => {
    api<Post>(`/posts/${encodeURIComponent(id)}`)
      .then(setPost)
      .catch((e) => { if (e instanceof ApiError && e.status === 404) setPost(null); });
  }, [id]);

  if (post === undefined) return <p className="muted">Loading…</p>;
  if (post === null) return <p>Post not found.</p>;
  return (
    <article className="post">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {post.fullUrl ? <img src={post.fullUrl} alt={post.caption || "photo"} /> : <p className="muted">{post.status}</p>}
      {post.caption && <p>{post.caption}</p>}
      <p className="muted small">{new Date(post.createdAt).toLocaleString()}</p>
    </article>
  );
}

export default function PostPage() {
  return (
    <>
      <Nav />
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <PostView />
        </Suspense>
      </main>
    </>
  );
}
