"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "../../components/Nav";
import { LikeButton } from "../../components/LikeButton";
import { api, ApiError, type Comment, type Post } from "../../lib/api";

function Comments({ postId }: { postId: string }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(cursor?: string) {
    const r = await api<{ items: Comment[]; next?: string }>(
      `/posts/${postId}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setItems((prev) => (cursor ? [...prev, ...r.items] : r.items));
    setNext(r.next);
  }
  useEffect(() => { load().catch(() => setError("Couldn't load comments.")); }, [postId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const c = await api<Comment>(`/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
      setItems((prev) => [...prev, c]);
      setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="comments">
      {items.map((c) => (
        <p key={c.commentId}><Link href={`/u?name=${c.username}`}><b>{c.username}</b></Link> {c.text}</p>
      ))}
      {next && <button className="link" onClick={() => load(next)}>More comments</button>}
      <form className="comment-form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add a comment…" aria-label="Comment" />
        <button type="submit" disabled={busy || !text.trim()}>Post</button>
      </form>
      <p className="error" role="alert">{error}</p>
    </section>
  );
}

function PostView() {
  const id = useSearchParams().get("id") ?? "";
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Post>(`/posts/${encodeURIComponent(id)}`)
      .then(setPost)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setPost(null) : setError("Couldn't load this post.")));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (post === undefined) return <p className="muted">Loading…</p>;
  if (post === null) return <p>Post not found.</p>;
  return (
    <article className="post">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {post.fullUrl ? <img src={post.fullUrl} alt={post.caption || "photo"} /> : <p className="muted">{post.status}</p>}
      {post.status === "READY" && (
        <div className="actions"><LikeButton postId={post.postId} liked={!!post.likedByMe} count={post.likeCount} /></div>
      )}
      {post.caption && <p>{post.caption}</p>}
      <p className="muted small">{new Date(post.createdAt).toLocaleString()}</p>
      {post.status === "READY" && <Comments postId={post.postId} />}
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
