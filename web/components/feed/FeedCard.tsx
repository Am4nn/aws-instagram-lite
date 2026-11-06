import Link from "next/link";
import { ImageOff, MessageCircle } from "lucide-react";
import { LikeButton } from "../LikeButton";
import { Avatar } from "../ui/Avatar";
import { Skeleton, SkeletonText } from "../ui/Skeleton";
import { fullDate, timeAgo } from "../../lib/time";
import type { FeedItem } from "../../lib/api";

/** One post in the home feed: header, square photo (links to the post), actions, caption, comments link. */
export function FeedCard({ post: p }: { post: FeedItem }) {
  const name = p.author.username;
  const postHref = `/p?id=${p.postId}&u=${encodeURIComponent(name)}`;
  const profileHref = `/u?name=${encodeURIComponent(name)}`;
  return (
    <article className="feed-card">
      <header className="feed-head">
        <Link href={profileHref} className="feed-avatar" tabIndex={-1} aria-hidden>
          <Avatar name={name} size="md" />
        </Link>
        <Link href={profileHref} className="author">{name}</Link>
        <span className="feed-dot" aria-hidden>·</span>
        <time className="feed-time" dateTime={p.createdAt} title={fullDate(p.createdAt)}>{timeAgo(p.createdAt)}</time>
      </header>

      {/* First post link in the card: the photo (smoke test clicks it). */}
      <Link href={postHref} className="feed-media" aria-label={`Open post by ${name}`}>
        {p.fullUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.fullUrl} alt={p.caption || `Photo by ${name}`} loading="lazy" decoding="async" />
        ) : (
          <span className="feed-media-missing"><ImageOff size={28} strokeWidth={1.5} aria-hidden /></span>
        )}
      </Link>

      <div className="actions">
        <LikeButton postId={p.postId} liked={!!p.likedByMe} count={p.likeCount} />
        <Link href={postHref} className="feed-comment-btn" aria-label={`Comments (${p.commentCount})`} title="Comment">
          <MessageCircle size={22} strokeWidth={1.8} aria-hidden />
          <span className="feed-count">{p.commentCount}</span>
        </Link>
      </div>

      {p.caption && (
        <p className="feed-caption">
          <Link href={profileHref} className="feed-caption-name">{name}</Link> {p.caption}
        </p>
      )}
      {p.commentCount > 0 && (
        <Link href={postHref} className="feed-comments muted">
          {p.commentCount === 1 ? "View 1 comment" : `View all ${p.commentCount} comments`}
        </Link>
      )}
    </article>
  );
}

/** Placeholder with the same box sizes as a FeedCard (header, square photo, action row, caption). */
export function FeedCardSkeleton() {
  return (
    <div className="feed-card feed-card-skeleton" aria-hidden>
      <div className="feed-head">
        <Skeleton circle w={32} h={32} />
        <Skeleton w={96} h={12} r={4} />
      </div>
      <Skeleton className="feed-media" ratio="1 / 1" />
      <div className="actions">
        <Skeleton w={52} h={20} r={4} />
        <Skeleton w={52} h={20} r={4} />
      </div>
      <div className="feed-caption"><SkeletonText lines={2} last="45%" /></div>
    </div>
  );
}
