"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { fetchIceServers, setVideoEncodingParams } from "@/lib/media";

type Props = {
  socket: Socket | null;
  joinCode: string;
  cameraSessionId: string;
  label: string;
  audioEnabled: boolean;
  /** MediaStream sent to viewers (camera only, or canvas-composited crop + same audio). */
  publishStream: MediaStream | null;
};

export function usePublisher({
  socket,
  joinCode,
  cameraSessionId,
  label,
  audioEnabled,
  publishStream,
}: Props) {
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const pendingRemoteCandidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const streamRef = useRef<MediaStream | null>(null);
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [remoteMuted, setRemoteMuted] = useState(false);

  useEffect(() => {
    streamRef.current = publishStream;
  }, [publishStream]);

  const hadPublishRef = useRef(false);
  useEffect(() => {
    if (publishStream) {
      hadPublishRef.current = true;
      return;
    }
    if (hadPublishRef.current && socket?.connected) {
      socket.emit("v1:camera:leave");
      hadPublishRef.current = false;
    }
  }, [publishStream, socket]);

  const stopAllPeers = useCallback(() => {
    for (const pc of peers.current.values()) {
      pc.close();
    }
    peers.current.clear();
    pendingRemoteCandidates.current.clear();
  }, []);

  const stopPublishing = useCallback(() => {
    if (socket?.connected) {
      socket.emit("v1:camera:leave");
    }
    stopAllPeers();
    setJoinedRoomId(null);
  }, [socket, stopAllPeers]);

  useEffect(() => {
    if (!socket) return;
    const onMute = (msg: { muted: boolean }) => {
      setRemoteMuted(msg.muted);
      const a = streamRef.current?.getAudioTracks()[0];
      if (a) a.enabled = !msg.muted;
    };
    socket.on("v1:control:mute-audio", onMute);
    return () => {
      socket.off("v1:control:mute-audio", onMute);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !joinCode || !cameraSessionId || !publishStream) return;

    const join = () => {
      socket.emit(
        "v1:camera:join",
        { joinCode: joinCode.trim().toUpperCase(), cameraSessionId, label },
        (ack: { ok: boolean; error?: string; roomId?: string }) => {
          if (ack?.ok && ack.roomId) {
            setJoinError(null);
            setJoinedRoomId(ack.roomId);
          } else {
            setJoinError(ack?.error ?? "Join failed");
            setJoinedRoomId(null);
          }
        },
      );
    };

    join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [socket, joinCode, cameraSessionId, label, publishStream]);

  useEffect(() => {
    if (!socket || !publishStream) return;

    const flush = async (viewerPeerId: string, pc: RTCPeerConnection) => {
      const q = pendingRemoteCandidates.current.get(viewerPeerId) ?? [];
      pendingRemoteCandidates.current.set(viewerPeerId, []);
      for (const c of q) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          // ignore
        }
      }
    };

    const onSubscriber = async (msg: { viewerPeerId: string }) => {
      peers.current.get(msg.viewerPeerId)?.close();
      const iceServers = await fetchIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      peers.current.set(msg.viewerPeerId, pc);
      pendingRemoteCandidates.current.set(msg.viewerPeerId, []);

      publishStream.getTracks().forEach((t) => {
        const sender = pc.addTrack(t, publishStream);
        if (t.kind === "video") setVideoEncodingParams(sender);
      });

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("v1:webrtc:candidate", {
            viewerPeerId: msg.viewerPeerId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            // ignore
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("v1:webrtc:offer", {
        viewerPeerId: msg.viewerPeerId,
        sdp: offer.sdp ?? "",
        type: offer.type,
      });
    };

    const onAnswer = async (msg: { viewerPeerId: string; sdp: string; type: string }) => {
      const pc = peers.current.get(msg.viewerPeerId);
      if (!pc) return;
      await pc.setRemoteDescription({ type: msg.type as RTCSdpType, sdp: msg.sdp });
      await flush(msg.viewerPeerId, pc);
    };

    const onCand = async (msg: { viewerPeerId?: string; candidate: RTCIceCandidateInit }) => {
      const id = msg.viewerPeerId;
      if (!id) return;
      const pc = peers.current.get(id);
      if (!pc || !pc.remoteDescription) {
        const q = pendingRemoteCandidates.current.get(id) ?? [];
        q.push(msg.candidate);
        pendingRemoteCandidates.current.set(id, q);
        return;
      }
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {
        // ignore
      }
    };

    socket.on("v1:control:subscriber-add", onSubscriber);
    socket.on("v1:webrtc:answer", onAnswer);
    socket.on("v1:webrtc:candidate", onCand);

    return () => {
      socket.off("v1:control:subscriber-add", onSubscriber);
      socket.off("v1:webrtc:answer", onAnswer);
      socket.off("v1:webrtc:candidate", onCand);
      stopAllPeers();
    };
  }, [socket, publishStream, stopAllPeers]);

  useEffect(() => {
    const a = publishStream?.getAudioTracks()[0];
    if (a) a.enabled = audioEnabled && !remoteMuted;
  }, [audioEnabled, remoteMuted, publishStream]);

  return {
    joinedRoomId,
    joinError,
    remoteMuted,
    stopPublishing,
  };
}
