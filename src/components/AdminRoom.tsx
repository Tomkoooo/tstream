'use client';

import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

interface StreamStats {
  fps: number;
  droppedFrames: number;
  bitrate: number;
}

const AdminRoom: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string>('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [fps, setFps] = useState<number>(30);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [bitrate, setBitrate] = useState<number>(2000);
  const [stats, setStats] = useState<StreamStats>({ fps: 0, droppedFrames: 0, bitrate: 0 });
  const socket = useRef<Socket | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());

  useEffect(() => {
    socket.current = io({ path: '/api/socket', transports: ['websocket'] });

    const initWebRTC = (participantId: string) => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && socket.current && roomId) {
          socket.current.emit('ice-candidate', event.candidate, roomId);
        }
      };

      peerConnections.current.set(participantId, pc);

      const updateStats = async () => {
        const stats = await pc.getStats();
        let currentFps = 0;
        let droppedFrames = 0;
        let currentBitrate = 0;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            currentFps = report.framesPerSecond || 0;
            droppedFrames = report.framesDropped || 0;
            currentBitrate = report.bytesReceived
              ? (report.bytesReceived * 8) / 1000
              : 0;
          }
        });

        setStats({ fps: currentFps, droppedFrames, bitrate: currentBitrate });
      };

      setInterval(updateStats, 1000);
    };

    if (socket.current) {
      socket.current.on('user-joined', (participantId: string) => {
        initWebRTC(participantId);
      });

      socket.current.on('participants', (participantIds: string[]) => {
        setParticipants(participantIds);
      });

      socket.current.on('offer', async (offer: RTCSessionDescriptionInit, participantId: string) => {
        const pc = peerConnections.current.get(participantId);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.current?.emit('answer', answer, roomId);
      });

      socket.current.on('ice-candidate', async (candidate: RTCIceCandidateInit) => {
        for (const pc of peerConnections.current.values()) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socket.current.on('user-left', (participantId: string) => {
        const pc = peerConnections.current.get(participantId);
        if (pc) {
          pc.close();
          peerConnections.current.delete(participantId);
        }
      });
    }

    return () => {
      socket.current?.disconnect();
      peerConnections.current.forEach((pc) => pc.close());
    };
  }, [roomId]);

  const handleCreateRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 10);
    setRoomId(newRoomId);
    const link = `${window.location.origin}/join/${newRoomId}`;
    setShareLink(link);
    socket.current?.emit('create-room', newRoomId);
  };

  const copyLinkToClipboard = () => {
    navigator.clipboard.writeText(shareLink);
    alert('Link copied to clipboard!');
  };

  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-4">Admin Room</h1>
        <button className="btn btn-primary mb-4" onClick={handleCreateRoom}>
          Create Room
        </button>
        {shareLink && (
          <div className="form-control w-full max-w-xs mb-4">
            <label className="label">
              <span className="label-text">Share Link</span>
            </label>
            <input
              type="text"
              value={shareLink}
              readOnly
              className="input input-bordered w-full"
            />
            <button className="btn btn-secondary mt-2" onClick={copyLinkToClipboard}>
              Copy Link
            </button>
          </div>
        )}
        <video ref={videoRef} autoPlay className="w-full max-w-lg mt-4" />
        <div className="stats shadow mt-4">
          <div className="stat">
            <div className="stat-title">FPS</div>
            <div className="stat-value">{stats.fps}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Dropped Frames</div>
            <div className="stat-value">{stats.droppedFrames}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Bitrate (kbps)</div>
            <div className="stat-value">{stats.bitrate}</div>
          </div>
        </div>
        <div className="form-control w-full max-w-xs mt-4">
          <label className="label">
            <span className="label-text">FPS</span>
          </label>
          <input
            type="range"
            min={15}
            max={60}
            value={fps}
            className="range range-primary"
            onChange={(e) => setFps(Number(e.target.value))}
          />
          <label className="label">
            <span className="label-text">Quality</span>
          </label>
          <div className="dropdown">
            <button className="btn btn-outline">Quality: {quality}</button>
            <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
              <li>
                <a onClick={() => setQuality('high')}>High</a>
              </li>
              <li>
                <a onClick={() => setQuality('medium')}>Medium</a>
              </li>
              <li>
                <a onClick={() => setQuality('low')}>Low</a>
              </li>
            </ul>
          </div>
          <label className="label">
            <span className="label-text">Bitrate (kbps)</span>
          </label>
          <input
            type="range"
            min={500}
            max={5000}
            value={bitrate}
            className="range range-primary"
            onChange={(e) => setBitrate(Number(e.target.value))}
          />
        </div>
        <div className="mt-4">
          <h2 className="text-xl font-bold">Participants</h2>
          <ul className="menu bg-base-100 w-56 rounded-box">
            {participants.map((id) => (
              <li key={id}>
                <a>User {id.slice(0, 8)}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AdminRoom;