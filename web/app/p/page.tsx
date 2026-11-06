"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlert, ImageOff, MessageCircle, TriangleAlert } from "lucide-react";
import { Nav } from "../../components/Nav";
import { LikeButton } from "../../components/LikeButton";
import { Avatar } from "../../components/ui/Avatar";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton";
import { Spinner } from "../../components/ui/Spinner";
import { agoLong } from "../../components/post/ago";
import { api, ApiError, type Comment, type Post, type Profile } from "../../lib/api";
import { fullDate, timeAgo } from "../../lib/time";

function CommentRow({ username, text, at, rowRef }: { username: string; text: string; at?: string; rowRef?: RefObject<HTMLDivElement | null> }) {
  const href = `/u?name=${encodeURIComponent(username)}`;
  return (
    <div className="comment" ref={rowRef}>
      <Link href={href} className="comment-avatar" tabIndex={-1} aria-hidden>
        <Avatar name={username} size="md" />
      </Link>
      <div className="comment-main">
        <p className="comment-text"><Link href={href} className="comment-user">{username}</Link> {text}</p>
        {at && <time className="comment-time" dateTime={at} title={fullDate(at)}>{timeAgo(at)}</time>}
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

function PostCard({ post, author }: { post: Post; author: string }) {
  const ready = post.status === "READY";
  const [items, setItems] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [next, setNext] = useState<string | undefined>();
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
  useEffect(() => { if (ready) loadFirst(); }, [post.postId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const authorHref = `/u?name=${encodeURIComponent(author)}`;
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
          <time className="post-time" dateTime={post.createdAt} title={fullDate(post.createdAt)}>{agoLong(post.createdAt)}</time>
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

function PostSkeleton() {
  return (
    <article className="post post-loading" aria-busy="true" aria-label="Loading post">
      <header className="post-head">
        <span className="post-author"><Skeleton circle w={32} h={32} /><Skeleton w={96} h={12} /></span>
      </header>
      <div className="post-media"><Skeleton className="post-media-skel" /></div>
      <div className="post-side">
        <div className="post-body"><CommentSkeleton /><CommentSkeleton /></div>
        <div className="post-foot">
          <div className="actions"><Skeleton w={52} h={24} /><Skeleton w={24} h={24} /></div>
          <Skeleton w={90} h={10} />
        </div>
      </div>
    </article>
  );
}

function PostView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const hintedAuthor = params.get("u") ?? "";
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [me, setMe] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    api<Post>(`/posts/${encodeURIComponent(id)}`)
      .then((p) => { if (alive) { setPost(p); setError(""); } })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setPost(null);
        else setError("Couldn't load this post.");
      });
    return () => { alive = false; };
  }, [id, tick]);

  // The post API has no author name; we know it when the link says (?u=) or when it's our own post.
  useEffect(() => { if (!hintedAuthor) api<Profile>("/me").then(setMe).catch(() => {}); }, [hintedAuthor]);

  // A fresh upload is still being processed: check again shortly.
  useEffect(() => {
    if (post?.status !== "PENDING") return;
    const t = setTimeout(() => setTick((n) => n + 1), 3000);
    return () => clearTimeout(t);
  }, [post]);

  if (error) {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load this post"
        hint="Check your connection and try again."
        action={<button type="button" className="secondary" onClick={() => { setError(""); setTick((n) => n + 1); }}>Try again</button>}
      />
    );
  }
  if (post === undefined) return <PostSkeleton />;
  if (post === null) {
    return (
      <EmptyState
        icon={ImageOff}
        title="Post not found"
        hint="It may have been removed, or the link is wrong."
        action={<Link className="btn secondary" href="/feed">Back to feed</Link>}
      />
    );
  }
  const author = hintedAuthor || (me && me.userId === post.userId ? me.username : "");
  return <PostCard key={post.postId} post={post} author={author} />;
}

export default function PostPage() {
  return (
    <>
      <Nav />
      <main className="wide post-page">
        <Suspense fallback={<PostSkeleton />}>
          <PostView />
        </Suspense>
      </main>
    </>
  );
}
