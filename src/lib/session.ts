import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth-session";
import { getSessionSecretFromEnv } from "@/lib/session-secret";

export function getSessionSecretForApi(): string {
  return getSessionSecretFromEnv();
}

export async function isRequestAuthed(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  return verifySession(getSessionSecretForApi(), token);
}
