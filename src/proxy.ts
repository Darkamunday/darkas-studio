import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie-presence gate for pages. The real session check happens in
// requireUser(); API routes do their own check and answer 401 instead.
// "/s" is public song pages (share links); each checks its own token.
const PUBLIC_PATHS = ["/login", "/signup", "/api", "/s"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
