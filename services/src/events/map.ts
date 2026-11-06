export type DomainEvent = { source: string; detailType: string; detail: Record<string, unknown> };

/**
 * Change data capture: a NEW item in the table *is* the fact. We derive the domain event from it,
 * so there's no "write to DB, then also publish" step that could half-fail (the dual-write problem).
 * `createdAt` comes from the row, so a re-published event still identifies the same fact.
 */
export function toDomainEvent(item: Record<string, any>): DomainEvent | null {
  const sk = String(item.sk ?? "");
  if (sk.startsWith("LIKE#")) {
    return { source: "ig.engage", detailType: "PostLiked",
      detail: { postId: item.postId, authorId: item.postAuthorId, actorId: item.userId, createdAt: item.createdAt } };
  }
  if (sk.startsWith("COMMENT#")) {
    return { source: "ig.engage", detailType: "PostCommented",
      detail: { postId: item.postId, authorId: item.postAuthorId, actorId: item.userId, commentId: item.commentId, text: item.text, createdAt: item.createdAt } };
  }
  if (sk.startsWith("FOLLOWER#")) {
    return { source: "ig.social", detailType: "UserFollowed",
      detail: { followerId: item.userId, followeeId: String(item.pk).replace(/^USER#/, ""), createdAt: item.createdAt } };
  }
  return null;
}
