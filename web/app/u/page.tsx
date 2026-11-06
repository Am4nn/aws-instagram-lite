"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Profile } from "../../lib/api";
import { PostGrid } from "../../components/PostGrid";
import { mySub } from "../../lib/auth";

type PublicProfile = Profile & { isFollowing: boolean };

// Static export can't pre-render /u/<every username>, so the name is a query param: /u?name=ann
function UserProfile() {
  const name = useSearchParams().get("name") ?? "";
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PublicProfile>(`/users/${encodeURIComponent(name)}`)
      .then(setProfile)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setProfile(null) : setError("Couldn't load this profile.")));
  }, [name]);

  if (error && profile === undefined) return <p className="error">{error}</p>;
  if (profile === undefined) return <p className="muted">Loading…</p>;
  if (profile === null) return <p>No user called @{name}.</p>;

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
  return (
    <section className="profile">
      <div className="profile-head">
        <h1>@{profile.username}</h1>
        {!isMe && (
          <button className={profile.isFollowing ? "secondary" : ""} onClick={toggleFollow} disabled={busy}>
            {profile.isFollowing ? "Following" : "Follow"}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <p>{profile.bio || <span className="muted">No bio yet.</span>}</p>
      <p className="counts">
        <span><b>{profile.postCount}</b> posts</span>
        <span><b>{profile.followerCount}</b> followers</span>
        <span><b>{profile.followingCount}</b> following</span>
      </p>
      <PostGrid userId={profile.userId} />
    </section>
  );
}

export default function UserPage() {
  return (
    <>
      <Nav />
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <UserProfile />
        </Suspense>
      </main>
    </>
  );
}
