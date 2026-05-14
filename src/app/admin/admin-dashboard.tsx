"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";
import { useSignalingSocket } from "@/hooks/use-signaling-socket";
import { useSubscriber } from "@/hooks/use-subscriber";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type RoomRecord = { id: string; name: string; code: string; createdAt: number };
type CameraPresence = {
  sessionId: string;
  roomId: string;
  socketId: string;
  label: string;
  audioMuted: boolean;
  updatedAt: number;
};

type Row = { room: RoomRecord; cameras: CameraPresence[] };

function CameraPreviewTile({
  socket,
  cameraSessionId,
}: {
  socket: Socket | null;
  cameraSessionId: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { remoteStream, connectionState } = useSubscriber({
    socket,
    cameraSessionId,
    enabled: Boolean(socket?.connected),
  });

  const info = useMemo(() => {
    const t = remoteStream?.getVideoTracks()[0];
    if (!t) return "";
    const s = t.getSettings();
    return `${s.width ?? "?"}×${s.height ?? "?"} @ ${s.frameRate ?? "?"}fps`;
  }, [remoteStream]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    if (remoteStream) {
      void el.play().catch(() => undefined);
    }
  }, [remoteStream]);

  return (
    <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-md border border-border/80 bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" playsInline muted autoPlay />
      <div className="absolute left-1 top-1 flex flex-col gap-1">
        <Badge variant="secondary" className="text-[10px]">
          {connectionState}
        </Badge>
        {info ? (
          <Badge variant="outline" className="text-[10px]">
            {info}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { socket, connected } = useSignalingSocket();
  const [rows, setRows] = useState<Row[]>([]);
  const [newName, setNewName] = useState("Table 1 Main");
  const [open, setOpen] = useState(false);

  const mergeRoomsIntoRows = useCallback((rooms: RoomRecord[]) => {
    setRows((prev) => {
      const prevCams = new Map<string, CameraPresence[]>();
      for (const r of prev) prevCams.set(r.room.id, r.cameras);
      return rooms.map((room) => ({
        room,
        cameras: prevCams.get(room.id) ?? [],
      }));
    });
  }, []);

  const applyRoomsFromApi = useCallback(async () => {
    const res = await fetch("/api/rooms", { credentials: "include" });
    if (!res.ok) {
      toast.error("Could not load rooms");
      return;
    }
    const data = (await res.json()) as { rooms: RoomRecord[] };
    mergeRoomsIntoRows(data.rooms);
  }, [mergeRoomsIntoRows]);

  const refreshRooms = useCallback(async () => {
    await applyRoomsFromApi();
    socket?.emit("v1:admin:join");
  }, [socket, applyRoomsFromApi]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void refreshRooms();
    }, 0);
    return () => window.clearTimeout(id);
  }, [refreshRooms]);

  useEffect(() => {
    if (!socket) return;
    const onSnap = (msg: { rooms: Row[] }) => {
      const snap = Array.isArray(msg.rooms) ? msg.rooms : [];
      // Empty snapshot can happen if signaling and API used separate in-memory stores (dev).
      // Prefer non-empty snapshot (includes cameras); otherwise re-sync room list from REST.
      if (snap.length > 0) {
        setRows(snap);
      } else {
        void applyRoomsFromApi();
      }
    };
    const onRoster = (msg: { roomId: string; cameras: CameraPresence[] }) => {
      setRows((prev) =>
        prev.map((r) => (r.room.id === msg.roomId ? { ...r, cameras: msg.cameras } : r)),
      );
    };
    socket.on("v1:admin:snapshot", onSnap);
    socket.on("v1:roster", onRoster);
    const join = () => socket.emit("v1:admin:join");
    socket.on("connect", join);
    if (socket.connected) join();
    return () => {
      socket.off("v1:admin:snapshot", onSnap);
      socket.off("v1:roster", onRoster);
      socket.off("connect", join);
    };
  }, [socket, applyRoomsFromApi]);

  async function createRoom() {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      toast.error("Could not create room");
      return;
    }
    toast.success("Room created");
    setOpen(false);
    await refreshRooms();
  }

  async function deleteRoom(id: string) {
    const res = await fetch(`/api/rooms/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      toast.error("Could not delete room");
      return;
    }
    toast.success("Room deleted");
    await refreshRooms();
  }

  async function rotateCode(id: string) {
    const res = await fetch(`/api/rooms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rotateCode: true }),
    });
    if (!res.ok) {
      toast.error("Could not rotate code");
      return;
    }
    toast.success("Join code rotated");
    await refreshRooms();
  }

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  function copyJoin(room: RoomRecord) {
    const url = `${origin}/camera?code=${encodeURIComponent(room.code)}`;
    void navigator.clipboard.writeText(url);
    toast.message("Copied join URL");
  }

  function muteRemote(sessionId: string, muted: boolean) {
    socket?.emit("v1:control:mute-audio", { cameraSessionId: sessionId, muted });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tournament dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Rooms, live cameras, and OBS-friendly viewer links. Signaling:{" "}
            <Badge variant={connected ? "default" : "destructive"}>{connected ? "live" : "offline"}</Badge>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/camera" className={buttonVariants({ variant: "secondary" })}>
            Open camera page
          </Link>
          <Button variant="outline" onClick={() => void refreshRooms()}>
            Refresh
          </Button>
          <Button variant="outline" onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setOpen(true)}>
          New room
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create room</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="roomName">Name</Label>
              <Input id="roomName" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={() => void createRoom()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="min-h-[60vh] rounded-lg border border-border/60">
        <div className="space-y-4 p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rooms yet. Create one to get a join code.</p>
          ) : null}
          {rows.map((row) => (
            <Card key={row.room.id} className="border-border/80">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg">{row.room.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Code <span className="font-mono tracking-widest">{row.room.code}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => copyJoin(row.room)}>
                    Copy join URL
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void rotateCode(row.room.id)}>
                    Rotate code
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void deleteRoom(row.room.id)}>
                    Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {row.cameras.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cameras connected.</p>
                ) : (
                  row.cameras.map((cam) => (
                    <div key={cam.sessionId} className="space-y-2 rounded-md border border-border/60 p-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{cam.label}</p>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {cam.sessionId}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Audio remote mute: {cam.audioMuted ? "yes" : "no"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`/view/${cam.sessionId}`}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({ size: "sm", variant: "secondary" })}
                          >
                            Open viewer (OBS)
                          </a>
                          <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1">
                            <span className="text-xs text-muted-foreground">Mute audio send</span>
                            <Switch
                              checked={cam.audioMuted}
                              onCheckedChange={(v) => muteRemote(cam.sessionId, v)}
                            />
                          </div>
                        </div>
                      </div>
                      <Separator />
                      <CameraPreviewTile socket={socket} cameraSessionId={cam.sessionId} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
