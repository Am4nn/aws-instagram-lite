import { LoginForm } from "../../components/login/LoginForm";
import { serverEnv } from "../../lib/server/env";
import { safeNext } from "../../lib/server/next-path";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const env = serverEnv();
  return (
    <LoginForm
      emailSignup={env.emailSignup}
      isLocal={!env.secureCookies}
      next={safeNext((await searchParams).next)}
    />
  );
}
