"use client";

import type { MouseEvent, RefObject, TouchEvent } from "react";
import { useCallback, useRef, useState } from "react";
import {
  applyTapToFocus,
  applyVideoAdvanced,
  type VideoTrackAdjustCapabilities,
} from "@/lib/media";

type Props = {
  stream: MediaStream | null;
  videoContainerRef: RefObject<HTMLElement | null>;
  caps: VideoTrackAdjustCapabilities;
  onCapsRefresh: () => void;
};

/**
 * Pinch-to-zoom (when `zoom` capability exists), double-click / armed tap for focus,
 * optional sliders for capabilities the browser exposes (often limited on iOS Safari).
 */
export function CameraPreviewControls({
  stream,
  videoContainerRef,
  caps,
  onCapsRefresh,
}: Props) {
  const pinchRef = useRef<{ d0: number; z0: number } | null>(null);
  const [armedFocus, setArmedFocus] = useState(false);

  const track = stream?.getVideoTracks()[0] ?? null;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const getZoom = useCallback(() => {
    const t = stream?.getVideoTracks()[0];
    if (!t?.getSettings) return caps.zoom?.min ?? 1;
    const z = (t.getSettings() as { zoom?: number }).zoom;
    if (typeof z === "number") return z;
    return caps.zoom?.min ?? 1;
  }, [stream, caps.zoom]);

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2 && caps.zoom) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { d0: d, z0: getZoom() };
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || !caps.zoom || !pinchRef.current || !track) return;
    e.preventDefault();
    const [a, b] = [e.touches[0], e.touches[1]];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = d / pinchRef.current.d0;
    const z = clamp(pinchRef.current.z0 * ratio, caps.zoom.min, caps.zoom.max);
    void applyVideoAdvanced(track, { zoom: z }).then(() => onCapsRefresh());
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  const onPreviewClick = async (e: MouseEvent<HTMLElement>) => {
    if (!track || !videoContainerRef.current) return;
    if (e.detail === 2) {
      await applyTapToFocus(track, e.clientX, e.clientY, videoContainerRef.current);
      return;
    }
    if (!armedFocus) return;
    await applyTapToFocus(track, e.clientX, e.clientY, videoContainerRef.current);
    setArmedFocus(false);
  };

  const slider = (key: keyof VideoTrackAdjustCapabilities, label: string) => {
    const r = caps[key];
    if (!r || !track) return null;
    const settings = track.getSettings?.() as Record<string, number | undefined>;
    const cur = settings?.[key] ?? r.min;
    return (
      <label key={String(key)} className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <input
          type="range"
          min={r.min}
          max={r.max}
          step={r.step ?? (r.max - r.min) / 20}
          defaultValue={cur}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            void applyVideoAdvanced(track, { [key]: v }).then(() => onCapsRefresh());
          }}
          className="w-full"
        />
      </label>
    );
  };

  if (!stream || !track) return null;

  return (
    <>
      {/* Gesture capture: upper part of preview so sliders stay usable */}
      <div
        className="absolute inset-0 bottom-[200px] z-10 touch-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onPreviewClick}
        role="presentation"
        aria-hidden
      />
      <div className="pointer-events-auto absolute right-0 bottom-0 left-0 z-20 max-h-[min(45vh,220px)] overflow-y-auto rounded-t-lg border border-white/10 bg-black/60 p-2 text-white backdrop-blur-sm">
        <p className="mb-2 text-[10px] text-white/70">
          Two-finger pinch on the upper preview to zoom when supported. Double-click (or arm tap-to-focus then tap)
          for autofocus. iOS WebRTC often does not expose the same controls as the native Camera app — use those
          controls when possible, then stream here.
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-xs ${armedFocus ? "bg-white text-black" : "bg-white/15"}`}
            onClick={(e) => {
              e.stopPropagation();
              setArmedFocus((v) => !v);
            }}
          >
            {armedFocus ? "Tap preview to focus…" : "Arm tap-to-focus"}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {slider("zoom", "Zoom")}
          {slider("saturation", "Saturation")}
          {slider("brightness", "Brightness")}
          {slider("contrast", "Contrast")}
          {slider("exposureCompensation", "Exposure")}
          {slider("colorTemperature", "Warm / cool")}
        </div>
      </div>
    </>
  );
}
