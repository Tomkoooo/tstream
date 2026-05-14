export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const res = await fetch("/api/ice-config", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load ICE config");
  const data = (await res.json()) as { iceServers: RTCIceServer[] };
  return data.iceServers ?? [];
}

export type AcquireCameraOptions = {
  audio: boolean;
  /** Exact deviceId from enumerateDevices (videoinput). Omit to use facingMode / default. */
  videoDeviceId?: string;
};

function videoConstraints(
  opts: AcquireCameraOptions,
  tier: "high" | "mid" | "low",
): MediaStreamConstraints {
  const base = {
    width: tier === "high" ? { ideal: 3840 } : tier === "mid" ? { ideal: 1920 } : true,
    height: tier === "high" ? { ideal: 2160 } : tier === "mid" ? { ideal: 1080 } : true,
    frameRate: tier === "low" ? { ideal: 30 } : { ideal: 60 },
  };
  const video = opts.videoDeviceId?.trim()
    ? { deviceId: { exact: opts.videoDeviceId.trim() }, ...base }
    : { facingMode: { ideal: "environment" }, ...base };
  return { audio: opts.audio, video: video as MediaTrackConstraints };
}

export async function acquireCameraStream(opts: AcquireCameraOptions): Promise<MediaStream> {
  const tiers: Array<"high" | "mid" | "low"> = opts.videoDeviceId ? ["high", "mid", "low"] : ["high", "mid", "low"];
  let lastErr: unknown;
  for (const tier of tiers) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(videoConstraints(opts, tier));
      await tuneVideoSender(s);
      return s;
    } catch (e) {
      lastErr = e;
    }
  }
  try {
    const video = opts.videoDeviceId?.trim()
      ? { deviceId: { exact: opts.videoDeviceId.trim() } }
      : { facingMode: "environment" as const };
    const s = await navigator.mediaDevices.getUserMedia({ video, audio: opts.audio });
    await tuneVideoSender(s);
    return s;
  } catch (e) {
    throw lastErr ?? e;
  }
}

/** Optional encoder hints — does not force pinch zoom (user controls zoom separately). */
async function tuneVideoSender(stream: MediaStream) {
  const vt = stream.getVideoTracks()[0];
  if (!vt || typeof vt.applyConstraints !== "function") return;
  try {
    const params = vt.getCapabilities?.() as Record<string, unknown> | undefined;
    if (params?.torch) {
      // leave torch off unless user toggles
    }
  } catch {
    // ignore
  }
}

export function setVideoEncodingParams(sender: RTCRtpSender | null) {
  if (!sender || typeof sender.getParameters !== "function") return;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    const enc = params.encodings[0] as RTCRtpEncodingParameters & {
      degradationPreference?: string;
    };
    if (enc) {
      enc.degradationPreference = "maintain-resolution";
    }
    void sender.setParameters(params);
  } catch {
    // ignore
  }
}

type CapabilityRange = { min: number; max: number; step?: number };

export type VideoTrackAdjustCapabilities = {
  zoom?: CapabilityRange;
  focusDistance?: CapabilityRange;
  exposureCompensation?: CapabilityRange;
  colorTemperature?: CapabilityRange;
  saturation?: CapabilityRange;
  contrast?: CapabilityRange;
  brightness?: CapabilityRange;
};

export function getVideoAdjustCapabilities(track: MediaStreamTrack | null): VideoTrackAdjustCapabilities {
  if (!track || typeof track.getCapabilities !== "function") return {};
  const raw = track.getCapabilities() as Record<string, CapabilityRange | undefined>;
  const pick = (k: string) => {
    const v = raw[k];
    if (v && typeof v.min === "number" && typeof v.max === "number") return v;
    return undefined;
  };
  return {
    zoom: pick("zoom"),
    focusDistance: pick("focusDistance"),
    exposureCompensation: pick("exposureCompensation"),
    colorTemperature: pick("colorTemperature"),
    saturation: pick("saturation"),
    contrast: pick("contrast"),
    brightness: pick("brightness"),
  };
}

export async function applyVideoAdvanced(
  track: MediaStreamTrack,
  partial: Record<string, number>,
): Promise<void> {
  if (!track || typeof track.applyConstraints !== "function") return;
  const advanced = Object.entries(partial).map(([key, value]) => ({ [key]: value }));
  await track.applyConstraints({ advanced } as unknown as MediaTrackConstraints);
}

/** Tap-to-focus best-effort (iOS / Chrome where supported). */
export async function applyTapToFocus(
  track: MediaStreamTrack,
  clientX: number,
  clientY: number,
  el: HTMLElement,
): Promise<void> {
  const rect = el.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!track || typeof track.applyConstraints !== "function") return;
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: "single-shot" } as unknown as MediaTrackConstraintSet],
    } as MediaTrackConstraints);
  } catch {
    // ignore
  }
  try {
    await track.applyConstraints({
      pointsOfInterest: [{ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }],
    } as MediaTrackConstraints);
  } catch {
    // ignore — not supported on many browsers
  }
}
