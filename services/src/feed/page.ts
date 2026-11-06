import type { Ref } from "./merge-types.js";

/** A paged source of post pointers, newest first, strictly older than `before`. */
export type Source = (before: string | undefined, limit: number) => Promise<{ refs: Ref[]; truncated: boolean }>;

/**
 * One feed page from several paged sources: my pushed feed + each followed celeb's posts (pulled).
 *
 * The trap: each source returns only its newest N rows. If source A was cut off at time T, A may
 * still hold unseen posts older than T, so we must not emit anything older than T from the other
 * sources yet, or we'd skip A's posts forever. So:
 *   floor = the newest cut-off point among truncated sources
 *   emit only items at/after the floor; if that leaves the page short, continue from the floor.
 * Pushed items whose author I no longer follow are dropped (read-time unfollow), so a page can
 * need several rounds; we cap rounds and hand back a cursor if still short.
 */
export async function pageFeed(o: {
  me: string;
  limit: number;
  before?: string;
  feed: Source;
  celebs: Source[];
  /** Which of these authors do I currently follow? (only asked about authors on this page) */
  isFollowing: (authorIds: string[]) => Promise<Set<string>>;
  maxRounds?: number;
}): Promise<{ items: Ref[]; next?: string }> {
  const items: Ref[] = [];
  const seen = new Set<string>();
  let cursor = o.before;

  for (let round = 0; round < (o.maxRounds ?? 4); round++) {
    const [feed, ...celebs] = await Promise.all([o.feed(cursor, o.limit * 2), ...o.celebs.map((s) => s(cursor, o.limit))]);
    const sources = [feed, ...celebs];
    const cutoffs = sources.filter((s) => s.truncated && s.refs.length).map((s) => s.refs[s.refs.length - 1].sortKey);
    const floor = cutoffs.length ? cutoffs.reduce((a, b) => (a > b ? a : b)) : undefined;

    const celebRefs = new Set(celebs.flatMap((s) => s.refs.map((r) => r.postId)));
    const candidates = sources.flatMap((s) => s.refs)
      .filter((r) => !floor || r.sortKey >= floor)
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
      .filter((r) => (seen.has(r.postId) ? false : (seen.add(r.postId), true)));

    // Celeb posts are followed by construction; pushed posts need the "still following?" check.
    const toCheck = [...new Set(candidates.filter((r) => r.authorId !== o.me && !celebRefs.has(r.postId)).map((r) => r.authorId))];
    const following = toCheck.length ? await o.isFollowing(toCheck) : new Set<string>();
    for (const r of candidates) {
      if (r.authorId !== o.me && !celebRefs.has(r.postId) && !following.has(r.authorId)) continue;
      items.push(r);
      if (items.length === o.limit) return { items, next: r.sortKey };
    }
    if (!floor) return { items }; // every source is exhausted
    cursor = floor; // everything at/after the floor was handled; continue strictly below it
  }
  return { items, next: cursor }; // still short after maxRounds: let the client ask again
}
