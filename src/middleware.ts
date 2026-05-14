import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth-session";
import { getSessionSecretFromEnv } from "@/lib/session-secret";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/socket.io")) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  let secret: string;
  try {
    secret = getSessionSecretFromEnv();
  } catch {
    return new NextResponse("Server misconfiguration: set SESSION_SECRET (min 16 chars).", {
      status: 500,
    });
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const ok = await verifySession(secret, token);
  if (!ok) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const nextTarget = pathname + request.nextUrl.search;
    url.searchParams.set("next", nextTarget);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
