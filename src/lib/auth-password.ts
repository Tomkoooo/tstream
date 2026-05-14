import { createHash, timingSafeEqual } from "crypto";

/** Constant-time comparison of SHA-256 digests for shared password. */
export function verifyPassword(expected: string, actual: string): boolean {
  const ha = createHash("sha256").update(expected, "utf8").digest();
  const hb = createHash("sha256").update(actual, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
