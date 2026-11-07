"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type Post, type Profile } from "../../lib/api";
import { PostGrid } from "../PostGrid";
import { ProfileHeader, ProfileTabs } from "./ProfileHeader";

export type PublicProfile = Profile & { isFollowing: boolean };

/** Someone's profile (server-rendered) with the Follow button. `isMe` = it's my own profile. */
export function UserView({ profile: first, posts, isMe }: { profile: PublicProfile; posts?: Post[] | null; isMe: boolean }) {
  const [profile, setProfile] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleFollow() {
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
      <PostGrid userId={profile.userId} username={profile.username} count={profile.postCount} isMe={isMe} initial={posts} />
    </section>
  );
}
