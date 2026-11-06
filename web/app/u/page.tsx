"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "../../components/Nav";
import { api, ApiError, type Profile } from "../../lib/api";
import { PostGrid } from "../../components/PostGrid";

// Static export can't pre-render /u/<every username>, so the name is a query param: /u?name=ann
function UserProfile() {
  const name = useSearchParams().get("name") ?? "";
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    api<Profile>(`/users/${encodeURIComponent(name)}`)
      .then(setProfile)
      .catch((e) => { if (e instanceof ApiError && e.status === 404) setProfile(null); });
  }, [name]);

  if (profile === undefined) return <p className="muted">Loading…</p>;
  if (profile === null) return <p>No user called @{name}.</p>;
  return (
    <section className="profile">
      <h1>@{profile.username}</h1>
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
