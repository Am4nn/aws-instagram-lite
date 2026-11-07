import { redirect } from "next/navigation";

/** Old static-export link /u?name=ann → /u/ann */
export default async function OldUserLink({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const name = (await searchParams).name;
  redirect(name ? `/u/${encodeURIComponent(name)}` : "/feed");
}
