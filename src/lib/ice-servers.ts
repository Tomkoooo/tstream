const defaultServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function parseIceServersFromEnv(raw: string | undefined): RTCIceServer[] {
  if (!raw?.trim()) return defaultServers;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultServers;
    return parsed as RTCIceServer[];
  } catch {
    return defaultServers;
  }
}

export function getServerIceServers(): RTCIceServer[] {
  return parseIceServersFromEnv(process.env.ICE_SERVERS_JSON);
}
