import "server-only";
import { headers } from "next/headers";

/**
 * The site's public base URL, for links people will share. APP_URL wins if
 * set; otherwise it's worked out from the request (the proxy forwards the
 * real host and scheme), so it's right whether you're on the domain or the LAN IP.
 */
export async function appUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? "http";
  return `${proto}://${host}`;
}
