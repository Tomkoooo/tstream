import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "tstream_session";

function getKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signSession(secret: string): Promise<string> {
  return new SignJWT({ v: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey(secret));
}

export async function verifySession(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, getKey(secret), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}
