/** A post pointer; sortKey = "<createdAt>#<postId>" sorts by time and is unique. */
export type Ref = { postId: string; authorId: string; sortKey: string };

/**
 * Read side of the hybrid feed: pushed items (my FEED# partition) + pulled celeb posts,
 * minus authors I unfollowed since they were pushed, newest first, one page.
 */
export function mergeFeed(o: {
  feedItems: Ref[]; celebPosts: Ref[]; following: Set<string>; me: string; limit: number;
}): { items: Ref[]; next?: string } {
  const seen = new Set<string>();
  const all = [...o.feedItems, ...o.celebPosts]
    .filter((r) => r.authorId === o.me || o.following.has(r.authorId))
    .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
    .filter((r) => (seen.has(r.postId) ? false : (seen.add(r.postId), true)));
  const items = all.slice(0, o.limit);
  return all.length > o.limit ? { items, next: items[items.length - 1].sortKey } : { items };
}
