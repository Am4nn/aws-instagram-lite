import { Nav } from "../../components/Nav";
import { NotificationsView } from "../../components/notifications/NotificationsView";
import { attempt, serverApi, serverApiOrNull } from "../../lib/server/api";
import type { Notif, Post } from "../../lib/types";

/**
 * Activity, rendered on the server: the list, a thumbnail for each post mentioned (one call per distinct
 * post, in parallel), and opening the page marks everything read.
 */
export default async function Notifications() {
  const r = await attempt(serverApi<{ items: Notif[]; unread?: number }>("/notifications"));
  const ids = [...new Set((r?.items ?? []).map((n) => n.postId).filter((x): x is string => !!x))];
  const [thumbs] = await Promise.all([
    Promise.all(ids.map(async (id) => {
      const p = await attempt(serverApiOrNull<Post>(`/posts/${encodeURIComponent(id)}`));
      return [id, p?.thumbUrl ?? p?.fullUrl ?? null] as const;
    })).then(Object.fromEntries),
    r ? attempt(serverApi("/notifications/read", { method: "POST", body: {} })) : undefined,
  ]);
  return (
    <>
      <Nav unread={0} />
      <main className="feed activity-page">
        <NotificationsView items={r?.items} unread={r?.unread ?? 0} thumbs={thumbs} />
      </main>
    </>
  );
}
