"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props = {
  source: MediaStream | null;
  enabled: boolean;
  /** 0–1: point on the sensor image to keep in view (dartboard off-center → adjust here). */
  focusX: number;
  focusY: number;
  /** 1 = full frame; higher = tighter crop (digital zoom on outgoing stream). */
  zoom: number;
  /** Long edge cap for encoder load (iPad). */
  maxOutputLongEdge?: number;
  onOutputStream: (stream: MediaStream | null) => void;
};

/**
 * Renders a cropped region of `source` video into a canvas and exposes
 * `canvas.captureStream()` + original audio as the outgoing publisher stream.
 */
export function StreamCanvasCrop({
  source,
  enabled,
  focusX,
  focusY,
  zoom,
  maxOutputLongEdge = 1920,
  onOutputStream,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef({ focusX, focusY, zoom: clamp(zoom, 1, 6) });

  useLayoutEffect(() => {
    paramsRef.current = { focusX: clamp(focusX, 0, 1), focusY: clamp(focusY, 0, 1), zoom: clamp(zoom, 1, 6) };
  }, [focusX, focusY, zoom]);

  useEffect(() => {
    if (!enabled || !source) {
      onOutputStream(null);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const vTrack = source.getVideoTracks()[0];
    if (!vTrack) {
      onOutputStream(null);
      return;
    }

    video.srcObject = source;
    video.muted = true;

    let out: MediaStream | null = null;
    let stopped = false;
    let rafId = 0;
    let loopStarted = false;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      onOutputStream(null);
      return;
    }

    let lastVw = 0;
    let lastVh = 0;

    const fitCanvasToVideo = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw < 2 || vh < 2) return false;
      if (vw === lastVw && vh === lastVh && canvas.width > 0) return true;
      lastVw = vw;
      lastVh = vh;
      const long = Math.max(vw, vh);
      const scale = long > maxOutputLongEdge ? maxOutputLongEdge / long : 1;
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      return true;
    };

    const draw = () => {
      if (stopped) return;
      if (!fitCanvasToVideo()) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const { focusX: fx, focusY: fy, zoom: z } = paramsRef.current;
      const cropW = vw / z;
      const cropH = vh / z;
      const cx = fx * vw;
      const cy = fy * vh;
      const sx = clamp(cx - cropW / 2, 0, vw - cropW);
      const sy = clamp(cy - cropH / 2, 0, vh - cropH);

      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);

      if (!out) {
        const cap = canvas.captureStream(30);
        for (const t of source.getAudioTracks()) {
          cap.addTrack(t);
        }
        out = cap;
        onOutputStream(out);
      }

      rafId = requestAnimationFrame(draw);
    };

    const start = () => {
      if (loopStarted || stopped) return;
      loopStarted = true;
      void video.play().catch(() => undefined);
      rafId = requestAnimationFrame(draw);
    };

    video.addEventListener("loadeddata", start);
    if (video.readyState >= 2) start();

    return () => {
      stopped = true;
      video.removeEventListener("loadeddata", start);
      cancelAnimationFrame(rafId);
      out?.getVideoTracks().forEach((t) => t.stop());
      out = null;
      onOutputStream(null);
      video.pause();
      video.srcObject = null;
      lastVw = 0;
      lastVh = 0;
    };
  }, [source, enabled, maxOutputLongEdge, onOutputStream]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed top-0 left-0 -z-10 h-px w-px overflow-hidden opacity-0" aria-hidden>
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
    </div>
  );
}
