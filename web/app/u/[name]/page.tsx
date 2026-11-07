import Link from "next/link";
import { UserX } from "lucide-react";
import { AppNav } from "../../../components/AppNav";
import { UserView, type PublicProfile } from "../../../components/profile/UserView";
import { EmptyState } from "../../../components/ui/EmptyState";
import { RetryButton } from "../../../components/ui/RetryButton";
import { attempt, mySub, serverApi, serverApiOrNull } from "../../../lib/server/api";
import type { Post } from "../../../lib/types";

/** /u/<username>: someone's profile + grid, rendered on the server. */
export default async function UserPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  // undefined = couldn't load, null = no such user
  const profile = await attempt(serverApiOrNull<PublicProfile>(`/users/${encodeURIComponent(name)}`));
  const [posts, me] = profile
    ? await Promise.all([
      attempt(serverApi<{ items: Post[] }>(`/users/${profile.userId}/posts`)).then((r) => r?.items ?? null),
      mySub(),
    ])
    : [undefined, null];

  let body;
  if (profile === undefined) {
    body = (
      <div className="grid-msg" role="alert">
        <p className="error">Couldn&apos;t load this profile.</p>
        <RetryButton className="secondary sm">Retry</RetryButton>
      </div>
    );
  } else if (profile === null) {
    body = (
      <EmptyState icon={UserX} title="User not found" hint={<>No one is called @{name}.</>}
        action={<Link className="btn secondary" href="/feed">Back to feed</Link>} />
    );
  } else {
    body = <UserView profile={profile} posts={posts} isMe={profile.userId === me} />;
  }
  return (
    <>
      <AppNav />
      <main className="wide">{body}</main>
    </>
  );
}
