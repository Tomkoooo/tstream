export function getSessionSecretFromEnv(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (min 16 chars) in production");
  }
  return "dev-only-session-secret-min-16-chars";
}
