import type { Metadata } from "next";
import { inviteStatus, userCount } from "@/lib/auth";
import { AuthForm } from "../auth-form";
import { signup } from "../actions";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.signup };
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const firstUser = userCount() === 0;
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() || undefined;
  const status = code ? inviteStatus(code) : null;
  const { m } = await getI18n();

  let heading = firstUser ? m.auth.setupHeading : m.auth.joinHeading;
  let blurb = firstUser ? m.auth.setupBlurb : m.auth.joinBlurb;
  if (!firstUser && status === "valid") {
    heading = m.auth.invitedHeading;
    blurb = m.auth.invitedBlurb;
  }

  return (
    <>
      <h1 className="text-3xl font-semibold">{heading}</h1>
      <p className="mb-8 mt-2 text-muted">{blurb}</p>
      {!firstUser && status && status !== "valid" && (
        <p role="alert" className="mb-6 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          {status === "used" ? m.auth.inviteLinkUsed : m.auth.inviteLinkInvalid}
        </p>
      )}
      <AuthForm
        mode="signup"
        action={signup}
        needsInvite={!firstUser}
        inviteCode={status === "valid" ? code : undefined}
      />
    </>
  );
}
