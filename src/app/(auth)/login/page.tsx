import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { login } from "../actions";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Welcome back</h1>
      <p className="mb-8 mt-2 text-muted">The jukebox missed you.</p>
      <AuthForm mode="login" action={login} />
    </>
  );
}
