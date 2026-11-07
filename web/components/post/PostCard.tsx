"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, MessageCircle, TriangleAlert } from "lucide-react";
import { LikeButton } from "../LikeButton";
import { Avatar } from "../ui/Avatar";
import { Skeleton, SkeletonText } from "../ui/Skeleton";
import { Spinner } from "../ui/Spinner";
import { Time } from "../ui/Time";
import { api, type Comment, type Post } from "../../lib/api";

function CommentRow({ username, text, at, rowRef }: { username: string; text: string; at?: string; rowRef?: RefObject<HTMLDivElement | null> }) {
  const href = `/u/${encodeURIComponent(username)}`;
  return (
    <div className="comment" ref={rowRef}>
      <Link href={href} className="comment-avatar" tabIndex={-1} aria-hidden>
        <Avatar name={username} size="md" />
      </Link>
      <div className="comment-main">
        <p className="comment-text"><Link href={href} className="comment-user">{username}</Link> {text}</p>
        {at && <Time className="comment-time" iso={at} />}
      </div>
    </div>
  );
}

function CommentSkeleton() {
  return (
    <div className="comment" aria-hidden>
      <Skeleton circle w={32} h={32} />
      <div className="comment-main" style={{ flex: 1 }}><SkeletonText lines={2} last="40%" /></div>
    </div>
  );
}

/**
 * One post: photo, caption, comments, like + comment form. Server-rendered with the first page of
 * comments (`comments`; undefined = the server couldn't load them → "Retry" in the browser).
 */
export function PostCard({ post, author, comments }: {
  post: Post; author: string; comments?: { items: Comment[]; next?: string };
}) {
  const ready = post.status === "READY";
  const router = useRouter();
  const [items, setItems] = useState<Comment[]>(comments?.items ?? []);
  const [loaded, setLoaded] = useState(!!comments);
  const [loadFailed, setLoadFailed] = useState(ready && !comments);
  const [next, setNext] = useState<string | undefined>(comments?.next);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);
  const scrollToLast = useRef(false);

  async function load(cursor?: string) {
    const r = await api<{ items: Comment[]; next?: string }>(
      `/posts/${post.postId}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    setItems((prev) => (cursor ? [...prev, ...r.items] : r.items));
    setNext(r.next);
  }

  function loadFirst() {
    setLoadFailed(false);
    load()
      .then(() => setLoaded(true))
      .catch(() => setLoadFailed(true));
  }

  // A fresh upload is still being processed: render the page again on the server shortly.
  useEffect(() => {
    if (post.status !== "PENDING") return;
    const t = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(t);
  }, [post, router]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    setError("");
    try {
      await load(next);
    } catch {
      setError("Couldn't load more comments.");
    } finally {
      setMore(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const c = await api<Comment>(`/posts/${post.postId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
      scrollToLast.current = true;
      setItems((prev) => [...prev, c]);
      setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // After posting, bring the new comment into view (inside the side panel on desktop).
  useEffect(() => {
    if (!scrollToLast.current) return;
    scrollToLast.current = false;
    lastRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [items]);

  let media;
  if (ready && post.fullUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    media = <img src={post.fullUrl} alt={post.caption || "Photo"} />;
  } else if (post.status === "PENDING") {
    media = (
      <div className="post-media-state">
        <Spinner size={22} label="Processing" />
        <span>Processing your photo…</span>
      </div>
    );
  } else if (post.status === "FAILED") {
    media = (
      <div className="post-media-state">
        <TriangleAlert size={28} strokeWidth={1.6} aria-hidden />
        <span>Couldn&apos;t process this photo</span>
        {post.failReason && <span className="xs muted">{post.failReason}</span>}
      </div>
    );
  } else {
    media = (
      <div className="post-media-state">
        <ImageOff size={28} strokeWidth={1.6} aria-hidden />
        <span>Photo unavailable</span>
      </div>
    );
  }

  const authorHref = `/u/${encodeURIComponent(author)}`;
  return (
    <article className={`post post-${post.status.toLowerCase()}`}>
      {author && (
        <header className="post-head">
          <Link href={authorHref} className="post-author">
            <Avatar name={author} size="md" />
            <span>{author}</span>
          </Link>
        </header>
      )}

      <div className="post-media">{media}</div>

      <div className="post-side">
        <div className="post-body">
          {post.caption && (
            author
              ? <CommentRow username={author} text={post.caption} />
              : <p className="post-caption">{post.caption}</p>
          )}
          {ready && (
            <section className="comments" aria-label="Comments">
              {!loaded && !loadFailed && <><CommentSkeleton /><CommentSkeleton /></>}
              {loadFailed && (
                <p className="comments-note">
                  Couldn&apos;t load comments. <button type="button" className="link" onClick={loadFirst}>Retry</button>
                </p>
              )}
              {loaded && items.length === 0 && (
                <p className="comments-note comments-empty">
                  <b>No comments yet</b>
                  <span className="muted">Start the conversation.</span>
                </p>
              )}
              {items.map((c, i) => (
                <CommentRow
                  key={c.commentId}
                  username={c.username}
                  text={c.text}
                  at={c.createdAt}
                  rowRef={i === items.length - 1 ? lastRef : undefined}
                />
              ))}
              {next && (
                <button type="button" className="link comments-more" onClick={loadMore} disabled={more}>
                  {more ? <Spinner size={14} /> : null}
                  View more comments
                </button>
              )}
            </section>
          )}
        </div>

        <div className="post-foot">
          {ready && (
            <div className="actions">
              <LikeButton postId={post.postId} liked={!!post.likedByMe} count={post.likeCount} />
              <button type="button" className="icon-btn" aria-label="Comment" title="Comment" onClick={() => inputRef.current?.focus()}>
                <MessageCircle size={24} strokeWidth={1.9} aria-hidden />
              </button>
            </div>
          )}
          <Time className="post-time" iso={post.createdAt} long />
        </div>

        {ready && (
          <form className="comment-form" onSubmit={send}>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="Add a comment…"
              aria-label="Comment"
              autoComplete="off"
            />
            <button type="submit" disabled={busy || !text.trim()}>Post</button>
          </form>
        )}
        {ready && <p className="error post-error" role="alert">{error}</p>}
      </div>
    </article>
  );
}
