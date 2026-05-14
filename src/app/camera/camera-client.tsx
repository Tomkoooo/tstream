"use client";

import { useCallback, useEffect, useReducer, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { customAlphabet } from "nanoid";
import { toast } from "sonner";
import { CameraPreviewControls } from "@/components/camera-preview-controls";
import { StreamCanvasCrop } from "@/components/stream-canvas-crop";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useSignalingSocket } from "@/hooks/use-signaling-socket";
import { usePublisher } from "@/hooks/use-publisher";
import { acquireCameraStream, getVideoAdjustCapabilities } from "@/lib/media";

const mkSession = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);

const STORAGE_KEY = "tstream_camera_session";

function readOrCreateSessionId(): string {
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = mkSession();
  sessionStorage.setItem(STORAGE_KEY, id);
  return id;
}

function noopSubscribe() {
  return () => {};
}

export function CameraClient() {
  const searchParams = useSearchParams();
  const codeFromUrl = useMemo(
    () => (searchParams.get("code") ?? searchParams.get("room") ?? "").trim().toUpperCase(),
    [searchParams],
  );
  const [manualJoinCode, setManualJoinCode] = useState("");
  const joinCode = codeFromUrl || manualJoinCode;
  const [label, setLabel] = useState("Camera");
  const [audioOn, setAudioOn] = useState(false);
  const [blackMode, setBlackMode] = useState(false);
  const [dimMode, setDimMode] = useState(false);
  const cameraSessionId = useSyncExternalStore(noopSubscribe, readOrCreateSessionId, () => "");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [, bumpCaps] = useReducer((n: number) => n + 1, 0);

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [croppedPublish, setCroppedPublish] = useState<MediaStream | null>(null);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [cropFocusX, setCropFocusX] = useState(0.5);
  const [cropFocusY, setCropFocusY] = useState(0.5);
  const [cropZoom, setCropZoom] = useState(1.35);

  const publishStream = useMemo(() => {
    if (cropEnabled && croppedPublish) return croppedPublish;
    return cameraStream;
  }, [cropEnabled, croppedPublish, cameraStream]);

  const onCroppedStream = useCallback((s: MediaStream | null) => {
    setCroppedPublish(s);
  }, []);

  const { socket, connected } = useSignalingSocket();
  const { joinedRoomId, joinError, remoteMuted, stopPublishing } = usePublisher({
    socket,
    joinCode: joinCode.trim().toUpperCase(),
    cameraSessionId,
    label,
    audioEnabled: audioOn,
    publishStream,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  const refreshVideoDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(all.filter((d) => d.kind === "videoinput"));
    } catch {
      // ignore
    }
  }, []);

  const stopAll = useCallback(() => {
    stopPublishing();
    setCropEnabled(false);
    setCroppedPublish(null);
    setCameraStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, [stopPublishing]);

  const startCamera = useCallback(async () => {
    setCameraStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setCroppedPublish(null);
    const id = videoDeviceId.trim();
    const s = await acquireCameraStream({
      audio: audioOn,
      videoDeviceId: id || undefined,
    });
    setCameraStream(s);
  }, [audioOn, videoDeviceId]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.srcObject = null;
    if (!publishStream) return;
    el.srcObject = publishStream;
    void el.play().catch(() => undefined);
  }, [publishStream]);

  const rawVideoTrack = cameraStream?.getVideoTracks()[0] ?? null;
  const caps = getVideoAdjustCapabilities(rawVideoTrack);

  const streaming = Boolean(publishStream && joinedRoomId);

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 pb-[max(env(safe-area-inset-bottom),12px)]">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Camera</h1>
          <p className="text-xs text-muted-foreground">
            Signaling <Badge variant={connected ? "default" : "destructive"}>{connected ? "live" : "offline"}</Badge>
          </p>
        </div>
        <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Dashboard
        </Link>
      </header>

      <div className="grid flex-1 gap-3 lg:grid-cols-[1fr_auto]">
        <div
          ref={previewContainerRef}
          className="relative min-h-[40vh] overflow-hidden rounded-xl border border-border/80 bg-black lg:min-h-[60vh]"
        >
          <video
            key={publishStream?.id ?? "no-stream"}
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          {blackMode ? <div className="pointer-events-none absolute inset-0 bg-black" /> : null}
          {!blackMode && dimMode ? (
            <div className="pointer-events-none absolute inset-0 bg-black/85" />
          ) : null}
          <div className="pointer-events-none absolute left-2 top-2 z-30 flex flex-wrap gap-2">
            <Badge variant={streaming ? "default" : "secondary"}>
              {streaming ? "LIVE (sending)" : publishStream ? "Preview" : "Idle"}
            </Badge>
            {cropEnabled ? (
              <Badge variant="outline" className="border-amber-500/60 text-amber-200">
                Crop on
              </Badge>
            ) : null}
            {joinError ? (
              <Badge variant="destructive" className="max-w-[70vw] truncate">
                {joinError}
              </Badge>
            ) : null}
            {remoteMuted ? <Badge variant="outline">Mic muted by admin</Badge> : null}
          </div>
          {cameraStream ? (
            <CameraPreviewControls
              stream={cameraStream}
              videoContainerRef={previewContainerRef}
              caps={caps}
              onCapsRefresh={bumpCaps}
            />
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-3 rounded-xl border border-border/80 p-3 lg:max-w-sm">
          <div className="space-y-2">
            <Label htmlFor="code">Join code</Label>
            <Input
              id="code"
              value={joinCode}
              onChange={(e) => setManualJoinCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono tracking-widest"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="videoinput">Camera device</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void refreshVideoDevices()}>
                Refresh list
              </Button>
            </div>
            <select
              id="videoinput"
              value={videoDeviceId}
              onChange={(e) => setVideoDeviceId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Default (usually back camera)</option>
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 8)}…`}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Labels often stay hidden until after the first camera permission. Pick a device, then Stop → Start to
              apply. Tap Refresh list after Allow camera.
            </p>
          </div>

          <Separator />

          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Crop / frame outgoing</p>
                <p className="text-xs text-muted-foreground">
                  Digital pan + zoom on what viewers see (good when the dartboard is off-center). Preview matches the
                  stream. Uses more CPU on iPad.
                </p>
              </div>
              <Switch
                checked={cropEnabled}
                disabled={!cameraStream}
                onCheckedChange={(v) => {
                  setCropEnabled(v);
                  if (!v) setCroppedPublish(null);
                }}
              />
            </div>
            {cropEnabled && cameraStream ? (
              <div className="grid gap-3 pt-1">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Horizontal center ({Math.round(cropFocusX * 100)}%)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(cropFocusX * 100)}
                    onChange={(e) => setCropFocusX(Number(e.target.value) / 100)}
                    className="w-full"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Vertical center ({Math.round(cropFocusY * 100)}%)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(cropFocusY * 100)}
                    onChange={(e) => setCropFocusY(Number(e.target.value) / 100)}
                    className="w-full"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Zoom ({cropZoom.toFixed(2)}×)</span>
                  <input
                    type="range"
                    min={100}
                    max={300}
                    step={1}
                    value={Math.round(cropZoom * 100)}
                    onChange={(e) => setCropZoom(Number(e.target.value) / 100)}
                    className="w-full"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <Separator />
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              className="h-16 text-lg"
              onClick={() =>
                void startCamera()
                  .then(() => {
                    void refreshVideoDevices();
                    bumpCaps();
                  })
                  .catch((e) => {
                    console.error(e);
                    toast.error("Could not access camera");
                  })
              }
              disabled={!joinCode.trim()}
            >
              Start
            </Button>
            <Button size="lg" variant="destructive" className="h-16 text-lg" onClick={() => stopAll()}>
              Stop
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Audio to stream</p>
              <p className="text-xs text-muted-foreground">Requires restart after toggling</p>
            </div>
            <Switch checked={audioOn} onCheckedChange={setAudioOn} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Black preview</p>
              <p className="text-xs text-muted-foreground">Does not affect outgoing video</p>
            </div>
            <Switch checked={blackMode} onCheckedChange={setBlackMode} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Dim preview</p>
              <p className="text-xs text-muted-foreground">Heavy dim overlay on this device only</p>
            </div>
            <Switch checked={dimMode} onCheckedChange={setDimMode} />
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Session{" "}
            <span className="font-mono" suppressHydrationWarning>
              {cameraSessionId || "…"}
            </span>
            {joinedRoomId ? (
              <>
                {" "}
                · Room <span className="font-mono">{joinedRoomId}</span>
              </>
            ) : null}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Tip: open the admin “join link” or add <span className="font-mono">?code=XXXXXXXX</span> to the URL; the
            code is applied automatically when the page loads.
          </p>
        </div>
      </div>

      {cameraStream && cropEnabled ? (
        <StreamCanvasCrop
          source={cameraStream}
          enabled={cropEnabled}
          focusX={cropFocusX}
          focusY={cropFocusY}
          zoom={cropZoom}
          onOutputStream={onCroppedStream}
        />
      ) : null}
    </div>
  );
}
