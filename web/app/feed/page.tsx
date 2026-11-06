"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Nav } from "../../components/Nav";
import { LikeButton } from "../../components/LikeButton";
import { api, type FeedItem } from "../../lib/api";

export default function Feed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [find, setFind] = useState("");
  const [error, setError] = useState("");

  async function load(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ items: FeedItem[]; next?: string }>(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      setItems((prev) => (cursor ? [...(prev ?? []), ...r.items] : r.items));
      setNext(r.next);
    } catch {
      setError(cursor ? "Couldn't load more posts." : "Couldn't load your feed.");
      if (!cursor) setItems((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function go(e: FormEvent) {
    e.preventDefault();
    if (find.trim()) window.location.href = `/u?name=${encodeURIComponent(find.trim())}`;
  }

  return (
    <>
      <Nav />
      <main>
        <form className="find" onSubmit={go}>
          <input placeholder="Find someone by username" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a user" />
          <button type="submit">Go</button>
        </form>
        {items === null && <p className="muted">Loading…</p>}
        {error && <p className="error">{error} <button className="link" onClick={() => load()}>Try again</button></p>}
        {items?.length === 0 && !error && !next && <p className="muted">Your feed is empty. Follow someone to see their posts here.</p>}
        {items?.map((p) => (
          <article key={p.postId} className="feed-card">
            <Link href={`/u?name=${p.author.username}`} className="author">@{p.author.username}</Link>
            <Link href={`/p?id=${p.postId}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.fullUrl} alt={p.caption || "photo"} loading="lazy" />
            </Link>
            <div className="actions">
              <LikeButton postId={p.postId} liked={!!p.likedByMe} count={p.likeCount} />
              <Link href={`/p?id=${p.postId}`} className="muted">💬 {p.commentCount}</Link>
            </div>
            {p.caption && <p>{p.caption}</p>}
            <p className="muted small">{new Date(p.createdAt).toLocaleString()}</p>
          </article>
        ))}
        {items?.length === 0 && next && !error && <p className="muted">Nothing new here yet…</p>}
        {next && (
          <button className="more" onClick={() => load(next)} disabled={loading}>{loading ? "Loading…" : "Load more"}</button>
        )}
      </main>
    </>
  );
}
