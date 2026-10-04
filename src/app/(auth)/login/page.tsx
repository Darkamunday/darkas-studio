import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { login } from "../actions";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.login };
}

export default async function LoginPage() {
  const { m } = await getI18n();
  return (
    <>
      <h1 className="text-3xl font-semibold">{m.auth.loginHeading}</h1>
      <p className="mb-8 mt-2 text-muted">{m.auth.loginBlurb}</p>
      <AuthForm mode="login" action={login} />
    </>
  );
}
