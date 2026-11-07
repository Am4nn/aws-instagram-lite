import { redirect } from "next/navigation";

/** Entry: proxy.ts has already sent logged-out visitors to /login, so this is a signed-in user. */
export default function Home() {
  redirect("/feed");
}
