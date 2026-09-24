import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type User = {
  id: number;
  username: string;
  is_admin: number;
};

// ---- passwords -------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---- sessions --------------------------------------------------------------

async function isHttps() {
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0].trim();
  return proto === "https";
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Must be called from a Server Action or Route Handler (sets a cookie). */
export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  db.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    hashToken(token),
    userId,
    expiresAt,
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // HTTPS-only when the request really came over HTTPS (the proxy says so), not
    // just "in production": plain-http LAN access must still be able to log in.
    secure: await isHttps(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Must be called from a Server Action or Route Handler (deletes a cookie). */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hashToken(token));
  store.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = db
    .prepare(
      `SELECT u.id, u.username, u.is_admin
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = ? AND s.expires_at > unixepoch() AND u.disabled = 0`,
    )
    .get(hashToken(token)) as User | undefined;
  return user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.is_admin) redirect("/");
  return user;
}

// ---- users -----------------------------------------------------------------

export function userCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function findUserForLogin(username: string) {
  return db
    .prepare("SELECT id, password_hash, disabled FROM users WHERE username = ?")
    .get(username) as { id: number; password_hash: string; disabled: number } | undefined;
}

export type InviteStatus = "valid" | "used" | "unknown";

export function inviteStatus(code: string): InviteStatus {
  const row = db.prepare("SELECT used_by FROM invite_codes WHERE code = ?").get(code.trim().toUpperCase()) as
    | { used_by: number | null }
    | undefined;
  if (!row) return "unknown";
  return row.used_by === null ? "valid" : "used";
}
