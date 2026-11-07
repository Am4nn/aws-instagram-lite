/** Shapes the HTTP API returns (shared by server components and browser code). */
export type Profile = {
  userId: string;
  username: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: string;
};

export type Post = {
  postId: string;
  userId: string;
  caption: string;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  likeCount: number;
  commentCount: number;
  failReason?: string;
  likedByMe?: boolean;
  thumbUrl?: string;
  fullUrl?: string;
};

export type FeedItem = Post & { author: { userId: string; username: string } };

export type Comment = { commentId: string; userId: string; username: string; text: string; createdAt: string };
export type Notif = {
  id: string;
  type: "PostLiked" | "PostCommented" | "UserFollowed";
  actorId: string;
  actorUsername: string;
  postId?: string;
  text?: string;
  at: string;
};
