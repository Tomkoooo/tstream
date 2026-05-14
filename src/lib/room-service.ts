import { customAlphabet, nanoid } from "nanoid";
import type { Redis } from "ioredis";
import { getRedis } from "@/lib/redis";

const joinCode = customAlphabet("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 8);

export type RoomRecord = {
  id: string;
  name: string;
  code: string;
  createdAt: number;
};

export type CameraPresence = {
  sessionId: string;
  roomId: string;
  socketId: string;
  label: string;
  audioMuted: boolean;
  updatedAt: number;
};

/** When false, an in-process store is used (no Redis). Fine for single-node / demos. */
export function usesRedisPersistence(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

// --- Redis key helpers (Redis path only) ---
const roomKey = (id: string) => `room:${id}`;
const codeKey = (code: string) => `room:code:${code}`;
const indexKey = "rooms:index";
const camerasSet = (roomId: string) => `room:${roomId}:cameras`;
const camKey = (sessionId: string) => `cam:${sessionId}`;

// --- In-memory store ---
// Use globalThis so API routes and the Socket.IO server share one store. In dev,
// Turbopack can load this module in separate graphs; module-level Maps would duplicate.
type MemoryStore = {
  rooms: Map<string, RoomRecord>;
  codeToId: Map<string, string>;
  cameras: Map<string, CameraPresence>;
  roomCameraIds: Map<string, Set<string>>;
};

declare global {
  var __tstreamMemoryStore: MemoryStore | undefined;
}

function getMemoryStore(): MemoryStore {
  if (!globalThis.__tstreamMemoryStore) {
    globalThis.__tstreamMemoryStore = {
      rooms: new Map(),
      codeToId: new Map(),
      cameras: new Map(),
      roomCameraIds: new Map(),
    };
  }
  return globalThis.__tstreamMemoryStore;
}

async function memAllocCode(): Promise<string> {
  const { codeToId } = getMemoryStore();
  for (let i = 0; i < 20; i++) {
    const c = joinCode();
    if (!codeToId.has(c)) return c;
  }
  throw new Error("Could not allocate join code");
}

async function memCreateRoom(name: string): Promise<RoomRecord> {
  const m = getMemoryStore();
  const id = nanoid(16);
  const code = await memAllocCode();
  const rec: RoomRecord = {
    id,
    name: name.trim() || "Untitled room",
    code,
    createdAt: Date.now(),
  };
  m.rooms.set(id, rec);
  m.codeToId.set(code, id);
  return rec;
}

async function memListRooms(): Promise<RoomRecord[]> {
  const { rooms } = getMemoryStore();
  return [...rooms.values()].sort((a, b) => b.createdAt - a.createdAt);
}

async function memGetRoomById(id: string): Promise<RoomRecord | null> {
  return getMemoryStore().rooms.get(id) ?? null;
}

async function memGetRoomIdByCode(code: string): Promise<string | null> {
  return getMemoryStore().codeToId.get(code.trim().toUpperCase()) ?? null;
}

async function memUpdateRoomName(id: string, name: string): Promise<RoomRecord | null> {
  const m = getMemoryStore();
  const cur = m.rooms.get(id);
  if (!cur) return null;
  const next: RoomRecord = { ...cur, name: name.trim() || cur.name };
  m.rooms.set(id, next);
  return next;
}

async function memDeleteRoom(id: string): Promise<void> {
  const m = getMemoryStore();
  const cur = m.rooms.get(id);
  if (!cur) return;
  m.rooms.delete(id);
  m.codeToId.delete(cur.code);
  const ids = m.roomCameraIds.get(id);
  if (ids) {
    for (const sid of ids) m.cameras.delete(sid);
  }
  m.roomCameraIds.delete(id);
}

async function memRotateRoomCode(id: string): Promise<RoomRecord | null> {
  const m = getMemoryStore();
  const cur = m.rooms.get(id);
  if (!cur) return null;
  const newCode = await memAllocCode();
  m.codeToId.delete(cur.code);
  const next: RoomRecord = { ...cur, code: newCode };
  m.rooms.set(id, next);
  m.codeToId.set(newCode, id);
  return next;
}

async function memSetCameraPresence(
  presence: Omit<CameraPresence, "updatedAt"> & { updatedAt?: number },
): Promise<void> {
  const m = getMemoryStore();
  const p: CameraPresence = {
    ...presence,
    updatedAt: presence.updatedAt ?? Date.now(),
  };
  m.cameras.set(p.sessionId, p);
  let set = m.roomCameraIds.get(p.roomId);
  if (!set) {
    set = new Set();
    m.roomCameraIds.set(p.roomId, set);
  }
  set.add(p.sessionId);
}

async function memRemoveCameraPresence(roomId: string, sessionId: string): Promise<void> {
  const m = getMemoryStore();
  m.cameras.delete(sessionId);
  m.roomCameraIds.get(roomId)?.delete(sessionId);
}

async function memListCamerasForRoom(roomId: string): Promise<CameraPresence[]> {
  const m = getMemoryStore();
  const ids = m.roomCameraIds.get(roomId);
  if (!ids?.size) return [];
  const out: CameraPresence[] = [];
  for (const sid of ids) {
    const c = m.cameras.get(sid);
    if (c) out.push(c);
  }
  return out;
}

async function memUpdateCameraAudioMuted(sessionId: string, audioMuted: boolean): Promise<CameraPresence | null> {
  const m = getMemoryStore();
  const cur = m.cameras.get(sessionId);
  if (!cur) return null;
  const next = { ...cur, audioMuted, updatedAt: Date.now() };
  m.cameras.set(sessionId, next);
  return next;
}

// --- Redis implementations ---
async function redisGenerateUniqueCode(r: Redis): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const c = joinCode();
    const exists = await r.exists(codeKey(c));
    if (!exists) return c;
  }
  throw new Error("Could not allocate join code");
}

async function redisCreateRoom(r: Redis, name: string): Promise<RoomRecord> {
  const id = nanoid(16);
  const code = await redisGenerateUniqueCode(r);
  const rec: RoomRecord = { id, name: name.trim() || "Untitled room", code, createdAt: Date.now() };
  const pipeline = r.pipeline();
  pipeline.set(roomKey(id), JSON.stringify(rec));
  pipeline.set(codeKey(code), id);
  pipeline.sadd(indexKey, id);
  await pipeline.exec();
  return rec;
}

async function redisListRooms(r: Redis): Promise<RoomRecord[]> {
  const ids = await r.smembers(indexKey);
  if (ids.length === 0) return [];
  const keys = ids.map(roomKey);
  const values = await r.mget(...keys);
  const out: RoomRecord[] = [];
  for (let i = 0; i < ids.length; i++) {
    const v = values[i];
    if (!v) continue;
    try {
      out.push(JSON.parse(v) as RoomRecord);
    } catch {
      // skip corrupt
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

async function redisGetRoomById(r: Redis, id: string): Promise<RoomRecord | null> {
  const v = await r.get(roomKey(id));
  if (!v) return null;
  return JSON.parse(v) as RoomRecord;
}

async function redisGetRoomIdByCode(r: Redis, code: string): Promise<string | null> {
  return (await r.get(codeKey(code.trim().toUpperCase()))) ?? null;
}

async function redisUpdateRoomName(r: Redis, id: string, name: string): Promise<RoomRecord | null> {
  const cur = await redisGetRoomById(r, id);
  if (!cur) return null;
  const next: RoomRecord = { ...cur, name: name.trim() || cur.name };
  await r.set(roomKey(id), JSON.stringify(next));
  return next;
}

async function redisDeleteRoom(r: Redis, id: string): Promise<void> {
  const cur = await redisGetRoomById(r, id);
  if (!cur) return;
  const camIds = await r.smembers(camerasSet(id));
  const pipeline = r.pipeline();
  pipeline.del(roomKey(id));
  pipeline.del(codeKey(cur.code));
  pipeline.srem(indexKey, id);
  for (const sid of camIds) {
    pipeline.del(camKey(sid));
  }
  pipeline.del(camerasSet(id));
  await pipeline.exec();
}

async function redisRotateRoomCode(r: Redis, id: string): Promise<RoomRecord | null> {
  const cur = await redisGetRoomById(r, id);
  if (!cur) return null;
  const newCode = await redisGenerateUniqueCode(r);
  const pipeline = r.pipeline();
  pipeline.del(codeKey(cur.code));
  const next: RoomRecord = { ...cur, code: newCode };
  pipeline.set(roomKey(id), JSON.stringify(next));
  pipeline.set(codeKey(newCode), id);
  await pipeline.exec();
  return next;
}

async function redisSetCameraPresence(
  r: Redis,
  presence: Omit<CameraPresence, "updatedAt"> & { updatedAt?: number },
): Promise<void> {
  const p: CameraPresence = {
    ...presence,
    updatedAt: presence.updatedAt ?? Date.now(),
  };
  const pipeline = r.pipeline();
  pipeline.set(camKey(p.sessionId), JSON.stringify(p));
  pipeline.sadd(camerasSet(p.roomId), p.sessionId);
  await pipeline.exec();
}

async function redisRemoveCameraPresence(r: Redis, roomId: string, sessionId: string): Promise<void> {
  const pipeline = r.pipeline();
  pipeline.del(camKey(sessionId));
  pipeline.srem(camerasSet(roomId), sessionId);
  await pipeline.exec();
}

async function redisListCamerasForRoom(r: Redis, roomId: string): Promise<CameraPresence[]> {
  const ids = await r.smembers(camerasSet(roomId));
  if (ids.length === 0) return [];
  const keys = ids.map(camKey);
  const vals = await r.mget(...keys);
  const out: CameraPresence[] = [];
  for (const v of vals) {
    if (!v) continue;
    try {
      out.push(JSON.parse(v) as CameraPresence);
    } catch {
      // skip
    }
  }
  return out;
}

async function redisUpdateCameraAudioMuted(
  r: Redis,
  sessionId: string,
  audioMuted: boolean,
): Promise<CameraPresence | null> {
  const v = await r.get(camKey(sessionId));
  if (!v) return null;
  const cur = JSON.parse(v) as CameraPresence;
  const next = { ...cur, audioMuted, updatedAt: Date.now() };
  await r.set(camKey(sessionId), JSON.stringify(next));
  return next;
}

// --- Public API ---
export async function createRoom(name: string): Promise<RoomRecord> {
  if (usesRedisPersistence()) return redisCreateRoom(getRedis(), name);
  return memCreateRoom(name);
}

export async function listRooms(): Promise<RoomRecord[]> {
  if (usesRedisPersistence()) return redisListRooms(getRedis());
  return memListRooms();
}

export async function getRoomById(id: string): Promise<RoomRecord | null> {
  if (usesRedisPersistence()) return redisGetRoomById(getRedis(), id);
  return memGetRoomById(id);
}

export async function getRoomIdByCode(code: string): Promise<string | null> {
  if (usesRedisPersistence()) return redisGetRoomIdByCode(getRedis(), code);
  return memGetRoomIdByCode(code);
}

export async function updateRoomName(id: string, name: string): Promise<RoomRecord | null> {
  if (usesRedisPersistence()) return redisUpdateRoomName(getRedis(), id, name);
  return memUpdateRoomName(id, name);
}

export async function deleteRoom(id: string): Promise<void> {
  if (usesRedisPersistence()) return redisDeleteRoom(getRedis(), id);
  return memDeleteRoom(id);
}

export async function rotateRoomCode(id: string): Promise<RoomRecord | null> {
  if (usesRedisPersistence()) return redisRotateRoomCode(getRedis(), id);
  return memRotateRoomCode(id);
}

export async function setCameraPresence(
  presence: Omit<CameraPresence, "updatedAt"> & { updatedAt?: number },
): Promise<void> {
  if (usesRedisPersistence()) return redisSetCameraPresence(getRedis(), presence);
  return memSetCameraPresence(presence);
}

export async function removeCameraPresence(roomId: string, sessionId: string): Promise<void> {
  if (usesRedisPersistence()) return redisRemoveCameraPresence(getRedis(), roomId, sessionId);
  return memRemoveCameraPresence(roomId, sessionId);
}

export async function listCamerasForRoom(roomId: string): Promise<CameraPresence[]> {
  if (usesRedisPersistence()) return redisListCamerasForRoom(getRedis(), roomId);
  return memListCamerasForRoom(roomId);
}

export async function updateCameraAudioMuted(sessionId: string, audioMuted: boolean): Promise<CameraPresence | null> {
  if (usesRedisPersistence()) return redisUpdateCameraAudioMuted(getRedis(), sessionId, audioMuted);
  return memUpdateCameraAudioMuted(sessionId, audioMuted);
}
