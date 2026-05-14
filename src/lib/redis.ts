import Redis from "ioredis";

declare global {
  var __tstreamRedis: Redis | undefined;
}

/** Only used when `REDIS_URL` is set (`usesRedisPersistence()` in room-service). */
export function getRedis(): Redis {
  if (!globalThis.__tstreamRedis) {
    const url = process.env.REDIS_URL?.trim();
    if (!url) throw new Error("REDIS_URL is not set but Redis persistence was requested");
    globalThis.__tstreamRedis = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return globalThis.__tstreamRedis;
}
