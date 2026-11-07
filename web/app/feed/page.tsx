import { AppNav } from "../../components/AppNav";
import { FeedView } from "../../components/feed/FeedView";
import { attempt, serverApi } from "../../lib/server/api";
import type { FeedItem } from "../../lib/types";

/** Home feed, rendered on the server: the first page of posts is in the HTML. */
export default async function Feed() {
  const first = await attempt(serverApi<{ items: FeedItem[]; next?: string }>("/feed"));
  return (
    <>
      <AppNav />
      <main className="feed">
        <FeedView first={first} />
      </main>
    </>
  );
}
