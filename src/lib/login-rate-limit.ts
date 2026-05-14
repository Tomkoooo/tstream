const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX = 30;

export function rateLimitLogin(key: string): boolean {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now > cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (cur.count >= MAX) return false;
  cur.count += 1;
  return true;
}
