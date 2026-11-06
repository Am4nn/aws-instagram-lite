import type { ReactNode } from "react";
import { Grid3x3 } from "lucide-react";
import type { Profile } from "../../lib/api";
import { Avatar } from "../ui/Avatar";
import { Skeleton, SkeletonText } from "../ui/Skeleton";

const fmt = (n: number) => new Intl.NumberFormat("en", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Avatar + @username + action + counts + bio. Desktop: avatar column left. Phone: compact, action full width. */
export function ProfileHeader({ profile, action }: { profile: Profile; action?: ReactNode }) {
  return (
    <header className="profile-header">
      <div className="ph-avatar"><Avatar name={profile.username} size="xl" /></div>
      <h1 className="ph-name">@{profile.username}</h1>
      {action && <div className="ph-action">{action}</div>}
      <ul className="ph-counts">
        <li><b>{fmt(profile.postCount)}</b> {plural(profile.postCount, "post")}</li>
        <li><b>{fmt(profile.followerCount)}</b> {plural(profile.followerCount, "follower")}</li>
        <li><b>{fmt(profile.followingCount)}</b> following</li>
      </ul>
      {profile.bio && <p className="ph-bio">{profile.bio}</p>}
    </header>
  );
}

/** Same footprint as ProfileHeader while /me or /users/:name loads. */
export function ProfileHeaderSkeleton() {
  return (
    <header className="profile-header" aria-busy="true" aria-label="Loading profile">
      <div className="ph-avatar"><Skeleton circle className="ph-avatar-skel" /></div>
      <div className="ph-name"><Skeleton w={140} h={24} /></div>
      <div className="ph-action"><Skeleton w={108} h={36} r={8} /></div>
      <div className="ph-counts"><Skeleton w={240} h={18} /></div>
      <div className="ph-bio"><SkeletonText lines={1} width={180} /></div>
    </header>
  );
}

/** The single "Posts" tab above the grid, like Instagram. */
export function ProfileTabs() {
  return (
    <div className="profile-tabs" role="tablist" aria-label="Profile sections">
      <span className="profile-tab" role="tab" aria-selected="true">
        <Grid3x3 size={12} strokeWidth={2.2} aria-hidden /> Posts
      </span>
    </div>
  );
}
