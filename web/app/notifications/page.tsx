"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "../../components/Nav";
import { api, type Notif } from "../../lib/api";

const verb: Record<Notif["type"], string> = {
  PostLiked: "liked your post",
  PostCommented: "commented:",
  UserFollowed: "started following you",
};

export default function Notifications() {
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: Notif[] }>("/notifications")
      .then((r) => {
        setItems(r.items);
        return api("/notifications/read", { method: "POST" }); // opening the page = read
      })
      .catch(() => setError("Couldn't load notifications."));
  }, []);

  return (
    <>
      <Nav unread={0} />
      <main>
        <h1>Notifications</h1>
        {error && <p className="error">{error}</p>}
        {items === null && !error && <p className="muted">Loading…</p>}
        {items?.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="notifs">
          {items?.map((n) => (
            <li key={n.id}>
              <Link href={`/u?name=${n.actorUsername}`}><b>{n.actorUsername}</b></Link> {verb[n.type]}
              {n.text && <> “{n.text}”</>}
              {n.postId && <> · <Link href={`/p?id=${n.postId}`}>view</Link></>}
              <span className="muted small"> · {new Date(n.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
