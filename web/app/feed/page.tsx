"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Search, Users } from "lucide-react";
import { Nav } from "../../components/Nav";
import { FeedCard, FeedCardSkeleton } from "../../components/feed/FeedCard";
import { EmptyState } from "../../components/ui/EmptyState";
import { Spinner } from "../../components/ui/Spinner";
import { api, type FeedItem } from "../../lib/api";

export default function Feed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [find, setFind] = useState("");
  const [error, setError] = useState("");
  const findRef = useRef<HTMLInputElement>(null);

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

  // Retry the request that failed: the next page if we already have posts, else the first page.
  const retry = () => load(items && items.length > 0 ? next : undefined);

  return (
    <>
      <Nav />
      <main className="feed">
        <form className="find" onSubmit={go} role="search">
          <Search className="find-icon" size={18} strokeWidth={1.8} aria-hidden />
          <input
            ref={findRef} type="search" placeholder="Find someone by username" value={find}
            onChange={(e) => setFind(e.target.value)} aria-label="Find a user" autoComplete="off" spellCheck={false}
          />
          <button type="submit" className="icon-btn find-go" aria-label="Go to profile" title="Go to profile" hidden={!find.trim()}>
            <ArrowRight size={18} strokeWidth={2} aria-hidden />
          </button>
        </form>

        {items === null && (
          <div aria-busy="true" aria-label="Loading feed">
            <FeedCardSkeleton />
            <FeedCardSkeleton />
          </div>
        )}

        {items?.length === 0 && !error && !next && (
          <EmptyState
            icon={Users}
            title="Your feed is empty"
            hint="Follow people to see their photos here."
            action={<button type="button" className="secondary" onClick={() => findRef.current?.focus()}>Find people</button>}
          />
        )}

        {items?.map((p) => <FeedCard key={p.postId} post={p} />)}

        {items?.length === 0 && next && !error && <p className="muted feed-note">Nothing new here yet…</p>}

        {error && (
          <div className={`feed-error ${items && items.length > 0 ? "" : "first"}`.trim()} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            <span>{error}</span>
            <button type="button" className="secondary sm" onClick={retry} disabled={loading}>Try again</button>
          </div>
        )}

        {next && !error && (
          <button type="button" className="secondary block more" onClick={() => load(next)} disabled={loading}>
            {loading ? <Spinner size={16} label="Loading more posts" /> : "Load more"}
          </button>
        )}
      </main>
    </>
  );
}
