import { redirect } from "next/navigation";

/** Old static-export link /p?id=abc&u=bob → /p/abc?u=bob */
export default async function OldPostLink({ searchParams }: { searchParams: Promise<{ id?: string; u?: string }> }) {
  const { id, u } = await searchParams;
  redirect(id ? `/p/${encodeURIComponent(id)}${u ? `?u=${encodeURIComponent(u)}` : ""}` : "/feed");
}
