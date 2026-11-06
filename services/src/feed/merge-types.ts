/** A post pointer; sortKey = "<createdAt>#<postId>" sorts by time and is unique. */
export type Ref = { postId: string; authorId: string; sortKey: string };
