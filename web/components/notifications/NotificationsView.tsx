"use client";

import Link from "next/link";
import { Heart, ImageIcon } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { RetryButton } from "../ui/RetryButton";
import { Time, useClock } from "../ui/Time";
import type { Notif } from "../../lib/types";

const verb: Record<Notif["type"], string> = {
  PostLiked: "liked your photo.",
  PostCommented: "commented:",
  UserFollowed: "started following you.",
};

const DAY = 24 * 3600 * 1000;
type Group = "Today" | "This week" | "Earlier";

/** `utc`: the server render doesn't know the viewer's time zone (see ui/Time.tsx). */
function groupOf(iso: string, now: number, utc: boolean): Group {
  const t = new Date(iso).getTime();
  const midnight = new Date(now);
  if (utc) midnight.setUTCHours(0, 0, 0, 0);
  else midnight.setHours(0, 0, 0, 0);
  if (t >= midnight.getTime()) return "Today";
  if (now - t < 7 * DAY) return "This week";
  return "Earlier";
}

/** Small photo on the right of a like/comment row. undefined = loading, null = no thumbnail. */
function Thumb({ postId, url }: { postId: string; url: string | null | undefined }) {
  return (
    <Link href={`/p/${postId}`} className="notif-thumb" aria-label="View post" title="View post">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : url === null ? <ImageIcon size={18} strokeWidth={1.6} aria-hidden /> : null}
    </Link>
  );
}

function Row({ n, unread, thumb }: { n: Notif; unread: boolean; thumb: string | null | undefined }) {
  const href = `/u/${encodeURIComponent(n.actorUsername)}`;
  return (
    <li className={unread ? "unread" : undefined}>
      <Link href={href} className="notif-avatar" tabIndex={-1} aria-hidden>
        <Avatar name={n.actorUsername} size="md" />
      </Link>
      <p className="notif-text">
        <Link href={href} className="notif-user">{n.actorUsername}</Link> {verb[n.type]}
        {n.text && <span className="notif-quote"> {n.text}</span>}{" "}
        <Time className="notif-time" iso={n.at} />
        {unread && <span className="sr-only"> (new)</span>}
      </p>
      {n.postId && <Thumb postId={n.postId} url={thumb} />}
    </li>
  );
}

/**
 * The activity list (server-rendered by app/notifications/page.tsx). `items` undefined = couldn't load.
 * `unread`: the first `unread` items (newest first) are new. `thumbs`: postId → thumbnail URL (null = none).
 */
export function NotificationsView({ items, unread, thumbs }: {
  items?: Notif[]; unread: number; thumbs: Record<string, string | null>;
}) {
  const { now, utc } = useClock();
  const groups: { label: Group; rows: { n: Notif; unread: boolean }[] }[] = [];
  items?.forEach((n, i) => {
    const label = groupOf(n.at, now, utc);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, rows: [] }));
    g.rows.push({ n, unread: i < unread });
  });

  return (
    <>
        <h1>Activity</h1>
        {!items && (
          <p className="error" role="alert">
            Couldn&apos;t load notifications. <RetryButton className="link">Try again</RetryButton>
          </p>
        )}
        {items?.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon"><Heart size={28} strokeWidth={1.5} aria-hidden /></span>
            <p className="empty-state-title">No activity yet</p>
            <p className="empty-state-hint muted">Likes, comments and new followers will show up here.</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="notif-group" aria-label={g.label}>
            <h2>{g.label}</h2>
            <ul className="notifs">
              {g.rows.map(({ n, unread }) => (
                <Row key={n.id} n={n} unread={unread} thumb={n.postId ? thumbs[n.postId] ?? null : undefined} />
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
