"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { db, transaction } from "@/lib/db";
import {
  createSession,
  destroySession,
  findUserForLogin,
  hashPassword,
  userCount,
  verifyPassword,
} from "@/lib/auth";
import type { Messages } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export type AuthFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

const signupSchema = (e: Messages["auth"]["errors"]) =>
  z.object({
    username: z
      .string()
      .trim()
      .min(3, { error: e.usernameMin })
      .max(24, { error: e.usernameMax })
      .regex(/^[a-zA-Z0-9_-]+$/, { error: e.usernameChars }),
    password: z.string().min(8, { error: e.passwordMin }).max(200),
    inviteCode: z.string().trim().optional(),
  });

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const e = (await getI18n()).m.auth.errors;
  const parsed = signupSchema(e).safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    inviteCode: formData.get("inviteCode") ?? undefined,
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const { username, password, inviteCode } = parsed.data;
  const passwordHash = await hashPassword(password);

  let userId: number;
  try {
    userId = transaction(() => {
      const isFirstUser = userCount() === 0;
      if (!isFirstUser) {
        const invite = db
          .prepare("SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL")
          .get(inviteCode?.toUpperCase() ?? "");
        if (!invite) throw new SignupError(e.inviteInvalid);
      }
      const existing = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
      if (existing) throw new SignupError(e.usernameTaken);

      const result = db
        .prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)")
        .run(username, passwordHash, isFirstUser ? 1 : 0);
      const id = Number(result.lastInsertRowid);
      if (!isFirstUser) {
        db.prepare("UPDATE invite_codes SET used_by = ?, used_at = unixepoch() WHERE code = ?").run(
          id,
          inviteCode!.toUpperCase(),
        );
      }
      return id;
    });
  } catch (err) {
    if (err instanceof SignupError) return { error: err.message };
    throw err;
  }

  await createSession(userId);
  redirect("/");
}

class SignupError extends Error {}

const LoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const e = (await getI18n()).m.auth.errors;
  const parsed = LoginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: e.loginMissing };

  const user = findUserForLogin(parsed.data.username);
  const ok = user ? await verifyPassword(parsed.data.password, user.password_hash) : false;
  if (!user || !ok) return { error: e.loginWrong };
  if (user.disabled) return { error: e.disabled };

  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
