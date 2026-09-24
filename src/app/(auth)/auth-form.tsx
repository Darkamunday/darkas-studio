"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btnPrimary, input, label } from "@/components/ui";
import type { AuthFormState } from "./actions";

type Props = {
  mode: "login" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  needsInvite?: boolean;
  /** Pre-filled from an invite link (?code=…). */
  inviteCode?: string;
};

export function AuthForm({ mode, action, needsInvite, inviteCode }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Username" name="username" autoComplete="username" errors={state?.fieldErrors?.username} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={isSignup ? "new-password" : "current-password"}
        errors={state?.fieldErrors?.password}
        hint={isSignup ? "At least 8 characters" : undefined}
      />
      {isSignup && needsInvite && (
        <Field
          label="Invite code"
          name="inviteCode"
          autoComplete="off"
          placeholder="ABCD-EFGH"
          defaultValue={inviteCode}
          errors={state?.fieldErrors?.inviteCode}
          mono
        />
      )}

      {state?.error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${btnPrimary} mt-2 py-3`}>
        {pending ? "One sec…" : isSignup ? "Create account" : "Log in"}
      </button>

      <p className="text-center text-sm text-muted">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-accent-fg hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            Got an invite?{" "}
            <Link href="/signup" className="font-medium text-accent-fg hover:underline">
              Sign up
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label: text,
  name,
  type = "text",
  autoComplete,
  placeholder,
  defaultValue,
  hint,
  errors,
  mono,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  defaultValue?: string;
  hint?: string;
  errors?: string[];
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={label}>{text}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={name !== "inviteCode" || undefined}
        className={`${input} py-2.5 ${mono ? "font-mono uppercase tracking-widest" : ""}`}
      />
      {hint && !errors?.length && <span className="text-xs text-subtle">{hint}</span>}
      {errors?.map((e) => (
        <span key={e} className="text-xs text-danger">
          {e}
        </span>
      ))}
    </label>
  );
}
