import { serverApi } from "../lib/server/api";
import { Nav } from "./Nav";

/** Server component: the nav with the unread-activity badge already filled in. */
export async function AppNav() {
  const unread = await serverApi<{ unread?: number }>("/notifications").then((r) => r.unread ?? 0, () => 0);
  return <Nav unread={unread} />;
}
