"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Heart, ImageIcon } from "lucide-react";
import { Nav } from "../../components/Nav";
import { Avatar } from "../../components/ui/Avatar";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton";
import { api, type Notif, type Post } from "../../lib/api";
import { fullDate, timeAgo } from "../../lib/time";

const verb: Record<Notif["type"], string> = {
  PostLiked: "liked your photo.",
  PostCommented: "commented:",
  UserFollowed: "started following you.",
};

const DAY = 24 * 3600 * 1000;
type Group = "Today" | "This week" | "Earlier";

function groupOf(iso: string, now: number): Group {
  const t = new Date(iso).getTime();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (t >= midnight.getTime()) return "Today";
  if (now - t < 7 * DAY) return "This week";
  return "Earlier";
}

/** Small photo on the right of a like/comment row. undefined = loading, null = no thumbnail. */
function Thumb({ postId, url }: { postId: string; url: string | null | undefined }) {
  return (
    <Link href={`/p?id=${postId}`} className="notif-thumb" aria-label="View post" title="View post">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : url === null ? <ImageIcon size={18} strokeWidth={1.6} aria-hidden /> : null}
    </Link>
  );
}

function Row({ n, unread, thumb }: { n: Notif; unread: boolean; thumb: string | null | undefined }) {
  const href = `/u?name=${encodeURIComponent(n.actorUsername)}`;
  return (
    <li className={unread ? "unread" : undefined}>
      <Link href={href} className="notif-avatar" tabIndex={-1} aria-hidden>
        <Avatar name={n.actorUsername} size="md" />
      </Link>
      <p className="notif-text">
        <Link href={href} className="notif-user">{n.actorUsername}</Link> {verb[n.type]}
        {n.text && <span className="notif-quote"> {n.text}</span>}{" "}
        <time className="notif-time" dateTime={n.at} title={fullDate(n.at)}>{timeAgo(n.at)}</time>
        {unread && <span className="sr-only"> (new)</span>}
      </p>
      {n.postId && <Thumb postId={n.postId} url={thumb} />}
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="notifs notifs-skel" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} style={{ listStyle: "none" }}>
          <Skeleton circle w={44} h={44} />
          <span style={{ flex: 1 }}><SkeletonText lines={2} last="35%" /></span>
          <Skeleton w={44} h={44} r={6} />
        </li>
      ))}
    </ul>
  );
}

export default function Notifications() {
  const [items, setItems] = useState<Notif[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<{ items: Notif[]; unread?: number }>("/notifications")
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread ?? 0); // newest first, so the first `unread` items are the new ones
        return api("/notifications/read", { method: "POST" }).catch(() => {}); // opening the page = read
      })
      .catch(() => setError("Couldn't load notifications."));
  }, [tick]);

  // Thumbnails for the posts mentioned (one request per distinct post).
  useEffect(() => {
    if (!items) return;
    const ids = [...new Set(items.map((n) => n.postId).filter((x): x is string => !!x))];
    for (const id of ids) {
      api<Post>(`/posts/${encodeURIComponent(id)}`)
        .then((p) => setThumbs((t) => ({ ...t, [id]: p.thumbUrl ?? p.fullUrl ?? null })))
        .catch(() => setThumbs((t) => ({ ...t, [id]: null })));
    }
  }, [items]);

  const now = Date.now();
  const groups: { label: Group; rows: { n: Notif; unread: boolean }[] }[] = [];
  items?.forEach((n, i) => {
    const label = groupOf(n.at, now);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, rows: [] }));
    g.rows.push({ n, unread: i < unread });
  });

  return (
    <>
      <Nav unread={0} />
      <main className="feed activity-page">
        <h1>Activity</h1>
        {error && (
          <p className="error" role="alert">
            {error} <button type="button" className="link" onClick={() => { setError(""); setTick((t) => t + 1); }}>Try again</button>
          </p>
        )}
        {items === null && !error && <SkeletonRows />}
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
                <Row key={n.id} n={n} unread={unread} thumb={n.postId ? thumbs[n.postId] : undefined} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
