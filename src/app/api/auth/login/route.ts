import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/auth-session";
import { verifyPassword } from "@/lib/auth-password";
import { getSessionSecretForApi } from "@/lib/session";
import { rateLimitLogin } from "@/lib/login-rate-limit";

const bodySchema = z.object({
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimitLogin(ip)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const expected = process.env.SESSION_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!verifyPassword(expected, parsed.data.password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await signSession(getSessionSecretForApi());
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
