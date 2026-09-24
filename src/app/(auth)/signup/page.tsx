import type { Metadata } from "next";
import { inviteStatus, userCount } from "@/lib/auth";
import { AuthForm } from "../auth-form";
import { signup } from "../actions";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const firstUser = userCount() === 0;
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() || undefined;
  const status = code ? inviteStatus(code) : null;

  let heading = firstUser ? "Set up the studio" : "Join the studio";
  let blurb = firstUser
    ? "No one's here yet — this first account becomes the admin."
    : "Bring your invite code and pull up a chair.";
  if (!firstUser && status === "valid") {
    heading = "You're invited!";
    blurb = "Your code's all filled in — just pick a username and password.";
  }

  return (
    <>
      <h1 className="text-3xl font-semibold">{heading}</h1>
      <p className="mb-8 mt-2 text-muted">{blurb}</p>
      {!firstUser && status && status !== "valid" && (
        <p role="alert" className="mb-6 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          {status === "used"
            ? "That invite link has already been used. Ask for a fresh one."
            : "That invite link isn't valid (it may have been revoked). Ask for a fresh one."}
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
