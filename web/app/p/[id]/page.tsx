import Link from "next/link";
import { CircleAlert, ImageOff } from "lucide-react";
import { AppNav } from "../../../components/AppNav";
import { PostCard } from "../../../components/post/PostCard";
import { EmptyState } from "../../../components/ui/EmptyState";
import { RetryButton } from "../../../components/ui/RetryButton";
import { attempt, serverApi, serverApiOrNull } from "../../../lib/server/api";
import type { Comment, Post, Profile } from "../../../lib/types";

/**
 * /p/<postId>?u=<author>: one post with its first comments, rendered on the server.
 * The post API has no author name; links pass it as ?u= (or it's my own post).
 */
export default async function PostPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ u?: string }>;
}) {
  const id = (await params).id;
  const hinted = (await searchParams).u ?? "";
  const [post, me] = await Promise.all([
    attempt(serverApiOrNull<Post>(`/posts/${encodeURIComponent(id)}`)), // undefined = error, null = not found
    hinted ? Promise.resolve(null) : attempt(serverApiOrNull<Profile>("/me")),
  ]);
  const comments = post?.status === "READY"
    ? await attempt(serverApi<{ items: Comment[]; next?: string }>(`/posts/${encodeURIComponent(id)}/comments`))
    : undefined;

  let body;
  if (post === undefined) {
    body = (
      <EmptyState icon={CircleAlert} title="Couldn't load this post" hint="Check your connection and try again."
        action={<RetryButton />} />
    );
  } else if (post === null) {
    body = (
      <EmptyState icon={ImageOff} title="Post not found" hint="It may have been removed, or the link is wrong."
        action={<Link className="btn secondary" href="/feed">Back to feed</Link>} />
    );
  } else {
    const author = hinted || (me && me.userId === post.userId ? me.username : "");
    // key includes the status: when a PENDING post turns READY the card starts fresh (comments etc.)
    body = <PostCard key={`${post.postId}-${post.status}`} post={post} author={author} comments={comments} />;
  }
  return (
    <>
      <AppNav />
      <main className="wide post-page">{body}</main>
    </>
  );
}
