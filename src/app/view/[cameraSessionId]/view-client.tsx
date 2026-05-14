"use client";

import { useEffect, useRef, useState } from "react";
import { useSignalingSocket } from "@/hooks/use-signaling-socket";
import { useSubscriber } from "@/hooks/use-subscriber";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ViewClient({ cameraSessionId }: { cameraSessionId: string }) {
  const { socket, connected } = useSignalingSocket();
  const { remoteStream, connectionState } = useSubscriber({
    socket,
    cameraSessionId,
    enabled: Boolean(socket?.connected && cameraSessionId),
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showHud, setShowHud] = useState(true);
  /** Browsers block autoplay on unmuted video; default muted so picture loads (OBS can add audio separately). */
  const [playbackMuted, setPlaybackMuted] = useState(true);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.srcObject = null;
    if (!remoteStream) return;
    el.srcObject = remoteStream;
    void el.play().catch(() => undefined);
  }, [remoteStream, playbackMuted]);

  return (
    <div className="fixed inset-0 bg-black">
      <video
        key={remoteStream?.id ?? "no-remote"}
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        autoPlay
        controls={false}
        muted={playbackMuted}
      />
      {showHud ? (
        <div className="pointer-events-auto absolute left-2 top-2 flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "default" : "destructive"}>{connected ? "live" : "offline"}</Badge>
          <Badge variant="secondary">{connectionState}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {cameraSessionId}
          </Badge>
        </div>
      ) : null}
      <div className="pointer-events-auto absolute right-2 top-2 flex flex-col items-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setShowHud((v) => !v)}>
          Toggle HUD
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="bg-black/50 text-white"
          onClick={() => {
            setPlaybackMuted(false);
            void videoRef.current?.play().catch(() => undefined);
          }}
        >
          Unmute playback
        </Button>
      </div>
    </div>
  );
}
