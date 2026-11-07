import { unstable_rethrow } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { MeView } from "../../components/me/MeView";
import { ApiError, attempt, serverApi, serverApiOrNull } from "../../lib/server/api";
import type { Post, Profile } from "../../lib/types";

/** My profile + grid, rendered on the server. No profile yet (404) = the "choose a username" form. */
export default async function Me() {
  let profile: Profile | null | undefined;
  let loadError = "";
  try {
    profile = await serverApiOrNull<Profile>("/me");
  } catch (e) {
    unstable_rethrow(e); // redirects
    loadError = e instanceof ApiError ? e.message : "Couldn't load your profile.";
  }
  const posts = profile ? (await attempt(serverApi<{ items: Post[] }>(`/users/${profile.userId}/posts`)))?.items ?? null : undefined;
  return (
    <>
      <AppNav />
      <MeView profile={profile} posts={posts} loadError={loadError} />
    </>
  );
}
