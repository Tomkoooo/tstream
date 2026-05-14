import type { RoomRecord, CameraPresence } from "@/lib/room-service";
import {
  getRoomIdByCode,
  getRoomById,
  setCameraPresence,
  removeCameraPresence,
  listCamerasForRoom,
  updateCameraAudioMuted,
  listRooms,
} from "@/lib/room-service";
import type { Server as HTTPServer } from "http";
import { Server, type Socket } from "socket.io";

export const SOCKET_PATH = "/socket.io";

type CameraSocketData = {
  role: "camera";
  roomId: string;
  cameraSessionId: string;
  label: string;
};

type ViewerSocketData = {
  role: "viewer";
  viewerPeerId: string;
  cameraSessionId: string;
};

type AdminSocketData = {
  role: "admin";
};

type SocketData = CameraSocketData | ViewerSocketData | AdminSocketData | Record<string, never>;

function isCamera(s: Socket): s is Socket & { data: CameraSocketData } {
  return Boolean(s.data && (s.data as CameraSocketData).role === "camera");
}

function isViewer(s: Socket): s is Socket & { data: ViewerSocketData } {
  return Boolean(s.data && (s.data as ViewerSocketData).role === "viewer");
}

function isAdmin(s: Socket): s is Socket & { data: AdminSocketData } {
  return Boolean(s.data && (s.data as AdminSocketData).role === "admin");
}

function forEachSocket(io: Server, fn: (s: Socket) => void) {
  for (const s of io.of("/").sockets.values()) {
    fn(s);
  }
}

async function broadcastRoomRoster(io: Server, roomId: string) {
  const cams = await listCamerasForRoom(roomId);
  io.to(`room:${roomId}`).emit("v1:roster", { roomId, cameras: cams });
  io.to("admin:global").emit("v1:roster", { roomId, cameras: cams });
}

export function attachSignaling(httpServer: HTTPServer) {
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    transports: ["websocket", "polling"],
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  io.on("connection", (socket: Socket) => {
    socket.on("v1:admin:join", async () => {
      (socket.data as SocketData) = { role: "admin" };
      await socket.join("admin:global");
      const rooms = await listRooms();
      const payload: { room: RoomRecord; cameras: CameraPresence[] }[] = [];
      for (const room of rooms) {
        const cameras = await listCamerasForRoom(room.id);
        payload.push({ room, cameras });
      }
      socket.emit("v1:admin:snapshot", { rooms: payload });
    });

    socket.on(
      "v1:camera:join",
      async (
        msg: { joinCode: string; cameraSessionId: string; label?: string },
        ack?: (r: { ok: boolean; error?: string; roomId?: string }) => void,
      ) => {
        try {
          const code = msg.joinCode?.trim().toUpperCase();
          if (!code || !msg.cameraSessionId) {
            ack?.({ ok: false, error: "Missing code or session" });
            return;
          }
          const roomId = await getRoomIdByCode(code);
          if (!roomId) {
            ack?.({ ok: false, error: "Invalid join code" });
            return;
          }
          const room = await getRoomById(roomId);
          if (!room) {
            ack?.({ ok: false, error: "Room missing" });
            return;
          }
          (socket.data as SocketData) = {
            role: "camera",
            roomId,
            cameraSessionId: msg.cameraSessionId,
            label: (msg.label ?? "Camera").slice(0, 80),
          };
          await socket.join(`room:${roomId}`);
          await setCameraPresence({
            sessionId: msg.cameraSessionId,
            roomId,
            socketId: socket.id,
            label: (msg.label ?? "Camera").slice(0, 80),
            audioMuted: false,
          });
          await broadcastRoomRoster(io, roomId);
          ack?.({ ok: true, roomId });
          // Publisher may restart getUserMedia (new device / constraints). That tears down old
          // RTCPeerConnections on the camera; re-signal existing viewers so they get a fresh offer.
          forEachSocket(io, (s) => {
            if (!isViewer(s)) return;
            if (s.data.cameraSessionId === msg.cameraSessionId) {
              socket.emit("v1:control:subscriber-add", { viewerPeerId: s.data.viewerPeerId });
            }
          });
        } catch (e) {
          console.error(e);
          ack?.({ ok: false, error: "Server error" });
        }
      },
    );

    socket.on(
      "v1:viewer:subscribe",
      async (
        msg: { cameraSessionId: string; viewerPeerId: string },
        ack?: (r: { ok: boolean; error?: string }) => void,
      ) => {
        if (!msg.cameraSessionId || !msg.viewerPeerId) {
          ack?.({ ok: false, error: "Missing ids" });
          return;
        }
        (socket.data as SocketData) = {
          role: "viewer",
          viewerPeerId: msg.viewerPeerId,
          cameraSessionId: msg.cameraSessionId,
        };
        forEachSocket(io, (s) => {
          if (!isCamera(s)) return;
          if (s.data.cameraSessionId === msg.cameraSessionId) {
            s.emit("v1:control:subscriber-add", { viewerPeerId: msg.viewerPeerId });
          }
        });
        ack?.({ ok: true });
      },
    );

    socket.on("v1:webrtc:offer", (payload: { viewerPeerId: string; sdp: string; type?: string }) => {
      if (!isCamera(socket)) return;
      const { cameraSessionId } = socket.data;
      forEachSocket(io, (s) => {
        if (!isViewer(s)) return;
        if (s.data.viewerPeerId === payload.viewerPeerId && s.data.cameraSessionId === cameraSessionId) {
          s.emit("v1:webrtc:offer", {
            sdp: payload.sdp,
            type: payload.type ?? "offer",
            cameraSessionId,
          });
        }
      });
    });

    socket.on("v1:webrtc:answer", (payload: { viewerPeerId: string; sdp: string; type?: string }) => {
      if (!isViewer(socket)) return;
      const { viewerPeerId, cameraSessionId } = socket.data;
      forEachSocket(io, (s) => {
        if (!isCamera(s)) return;
        if (s.data.cameraSessionId === cameraSessionId) {
          s.emit("v1:webrtc:answer", {
            viewerPeerId,
            sdp: payload.sdp,
            type: payload.type ?? "answer",
          });
        }
      });
    });

    socket.on(
      "v1:webrtc:candidate",
      (payload: { viewerPeerId?: string; candidate: unknown }) => {
        if (isViewer(socket)) {
          const { viewerPeerId, cameraSessionId } = socket.data;
          forEachSocket(io, (s) => {
            if (!isCamera(s)) return;
            if (s.data.cameraSessionId === cameraSessionId) {
              s.emit("v1:webrtc:candidate", { viewerPeerId, candidate: payload.candidate });
            }
          });
          return;
        }
        if (isCamera(socket)) {
          const { cameraSessionId } = socket.data;
          const target = payload.viewerPeerId;
          if (!target) return;
          forEachSocket(io, (s) => {
            if (!isViewer(s)) return;
            if (s.data.viewerPeerId === target && s.data.cameraSessionId === cameraSessionId) {
              s.emit("v1:webrtc:candidate", { candidate: payload.candidate });
            }
          });
        }
      },
    );

    socket.on("v1:control:mute-audio", async (payload: { cameraSessionId: string; muted: boolean }) => {
      if (!isAdmin(socket)) return;
      const updated = await updateCameraAudioMuted(payload.cameraSessionId, payload.muted);
      forEachSocket(io, (s) => {
        if (!isCamera(s)) return;
        if (s.data.cameraSessionId === payload.cameraSessionId) {
          s.emit("v1:control:mute-audio", { muted: payload.muted });
        }
      });
      if (updated) await broadcastRoomRoster(io, updated.roomId);
    });

    socket.on("v1:camera:leave", async () => {
      if (!isCamera(socket)) return;
      const { roomId, cameraSessionId } = socket.data;
      await removeCameraPresence(roomId, cameraSessionId);
      await socket.leave(`room:${roomId}`);
      (socket.data as SocketData) = {};
      await broadcastRoomRoster(io, roomId);
    });

    socket.on("disconnect", async () => {
      try {
        if (isCamera(socket)) {
          const { roomId, cameraSessionId } = socket.data;
          await removeCameraPresence(roomId, cameraSessionId);
          await broadcastRoomRoster(io, roomId);
        }
      } catch (e) {
        console.error(e);
      }
    });
  });

  return io;
}
