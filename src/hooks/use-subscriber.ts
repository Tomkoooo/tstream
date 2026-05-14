"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { customAlphabet } from "nanoid";
import { fetchIceServers } from "@/lib/media";

const mkViewerId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

type Props = {
  socket: Socket | null;
  cameraSessionId: string;
  enabled: boolean;
};

type OfferMsg = { sdp: string; type: string; cameraSessionId: string };

export function useSubscriber({ socket, cameraSessionId, enabled }: Props) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const viewerPeerIdRef = useRef<string | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<RTCPeerConnectionState>("new");

  useEffect(() => {
    if (!socket || !enabled || !cameraSessionId) return;

    let disposed = false;
    const viewerPeerId = mkViewerId();
    viewerPeerIdRef.current = viewerPeerId;

    /** Offers can arrive before fetchIceServers + PC creation (e.g. fast re-signaling). */
    let bufferedOffer: OfferMsg | null = null;
    const bufferedIce: RTCIceCandidateInit[] = [];

    const applyOffer = async (msg: OfferMsg, pc: RTCPeerConnection) => {
      await pc.setRemoteDescription({ type: msg.type as RTCSdpType, sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("v1:webrtc:answer", {
        viewerPeerId,
        sdp: answer.sdp ?? "",
        type: answer.type,
      });
      while (pending.current.length) {
        const c = pending.current.shift();
        if (!c) break;
        try {
          await pc.addIceCandidate(c);
        } catch {
          // ignore
        }
      }
    };

    const onOffer = async (msg: OfferMsg) => {
      if (msg.cameraSessionId !== cameraSessionId) return;
      const pc = pcRef.current;
      if (!pc) {
        bufferedOffer = msg;
        return;
      }
      try {
        await applyOffer(msg, pc);
      } catch {
        setState("failed");
      }
    };

    const onCand = async (msg: { candidate?: RTCIceCandidateInit }) => {
      if (!msg.candidate) return;
      const pc = pcRef.current;
      if (!pc) {
        bufferedIce.push(msg.candidate);
        return;
      }
      if (!pc.remoteDescription) {
        pending.current.push(msg.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {
        // ignore
      }
    };

    socket.on("v1:webrtc:offer", onOffer);
    socket.on("v1:webrtc:candidate", onCand);

    void (async () => {
      const iceServers = await fetchIceServers();
      if (disposed) return;
      const pc = new RTCPeerConnection({ iceServers });
      if (disposed) {
        pc.close();
        return;
      }
      pcRef.current = pc;
      pc.ontrack = (ev) => {
        if (ev.streams[0]) setRemoteStream(ev.streams[0]);
      };
      pc.onconnectionstatechange = () => {
        setState(pc.connectionState);
        if (pc.connectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            // ignore
          }
        }
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("v1:webrtc:candidate", { candidate: ev.candidate.toJSON() });
        }
      };

      const offerToApply = bufferedOffer;
      bufferedOffer = null;
      if (offerToApply) {
        try {
          await applyOffer(offerToApply, pc);
        } catch {
          setState("failed");
        }
      }

      for (const c of bufferedIce) {
        if (!pc.remoteDescription) pending.current.push(c);
        else {
          try {
            await pc.addIceCandidate(c);
          } catch {
            // ignore
          }
        }
      }
      bufferedIce.length = 0;

      socket.emit(
        "v1:viewer:subscribe",
        { cameraSessionId, viewerPeerId },
        (ack: { ok: boolean }) => {
          if (!ack?.ok) setState("failed");
        },
      );
    })();

    return () => {
      disposed = true;
      socket.off("v1:webrtc:offer", onOffer);
      socket.off("v1:webrtc:candidate", onCand);
      pcRef.current?.close();
      pcRef.current = null;
      viewerPeerIdRef.current = null;
      pending.current = [];
      setRemoteStream(null);
      setState("closed");
    };
  }, [socket, cameraSessionId, enabled]);

  return { remoteStream, connectionState: state };
}
