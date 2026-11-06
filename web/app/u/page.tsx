"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UserX } from "lucide-react";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Profile } from "../../lib/api";
import { PostGrid } from "../../components/PostGrid";
import { ProfileHeader, ProfileHeaderSkeleton, ProfileTabs } from "../../components/profile/ProfileHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { mySub } from "../../lib/auth";

type PublicProfile = Profile & { isFollowing: boolean };

function Loading() {
  return (
    <section className="profile">
      <ProfileHeaderSkeleton />
      <ProfileTabs />
      <div className="grid" aria-hidden>{Array.from({ length: 6 }, (_, i) => <span key={i} className="tile skeleton" />)}</div>
    </section>
  );
}

// Static export can't pre-render /u/<every username>, so the name is a query param: /u?name=ann
function UserProfile() {
  const name = useSearchParams().get("name") ?? "";
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError("");
    api<PublicProfile>(`/users/${encodeURIComponent(name)}`)
      .then(setProfile)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setProfile(null) : setError("Couldn't load this profile.")));
  }, [name, attempt]);

  if (error && profile === undefined) {
    return (
      <div className="grid-msg" role="alert">
        <p className="error">{error}</p>
        <button type="button" className="secondary sm" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </div>
    );
  }
  if (profile === undefined) return <Loading />;
  if (profile === null) {
    return (
      <EmptyState icon={UserX} title="User not found" hint={<>No one is called @{name}.</>}
        action={<Link className="btn secondary" href="/feed">Back to feed</Link>} />
    );
  }

  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ following: boolean }>(`/users/${profile.userId}/follow`, {
        method: profile.isFollowing ? "DELETE" : "POST",
      });
      const delta = r.following === profile.isFollowing ? 0 : r.following ? 1 : -1;
      setProfile({ ...profile, isFollowing: r.following, followerCount: profile.followerCount + delta });
    } catch {
      setError("Couldn't update follow. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const isMe = profile.userId === mySub();
  const action = isMe ? (
    <Link className="btn secondary" href="/me">Edit profile</Link>
  ) : (
    <button type="button" className={`follow-btn ${profile.isFollowing ? "secondary" : ""}`} onClick={toggleFollow}
      disabled={busy} aria-pressed={profile.isFollowing}
      title={profile.isFollowing ? `Unfollow @${profile.username}` : undefined}>
      {profile.isFollowing ? "Following" : "Follow"}
    </button>
  );
  return (
    <section className="profile">
      <ProfileHeader profile={profile} action={action} />
      {error && <p className="error ph-error" role="alert">{error}</p>}
      <ProfileTabs />
      <PostGrid userId={profile.userId} username={profile.username} count={profile.postCount} isMe={isMe} />
    </section>
  );
}

export default function UserPage() {
  return (
    <>
      <Nav />
      <main className="wide">
        <Suspense fallback={<Loading />}>
          <UserProfile />
        </Suspense>
      </main>
    </>
  );
}
