'use client';

import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

interface StreamStats {
  fps: number;
  droppedFrames: number;
  bitrate: number;
}

const StreamRoom: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fps, setFps] = useState<number>(30);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [bitrate, setBitrate] = useState<number>(2000);
  const [stats, setStats] = useState<StreamStats>({ fps: 0, droppedFrames: 0, bitrate: 0 });
  const socket = useRef<Socket | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    socket.current = io({ path: '/api/socket' });

    const initStream = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            frameRate: { ideal: fps },
            width: { ideal: quality === 'high' ? 1280 : quality === 'medium' ? 640 : 320 },
            height: { ideal: quality === 'high' ? 720 : quality === 'medium' ? 360 : 180 },
          },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        peerConnection.current = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        stream.getTracks().forEach((track) => {
          peerConnection.current?.addTrack(track, stream);
        });

        peerConnection.current.ontrack = (event) => {
          if (videoRef.current) {
            videoRef.current.srcObject = event.streams[0];
          }
        };

        peerConnection.current.onicecandidate = (event) => {
          if (event.candidate && socket.current) {
            socket.current.emit('ice-candidate', event.candidate, 'room-id');
          }
        };

        // WebRTC statisztikák
        const updateStats = async () => {
          if (!peerConnection.current) return;
          const stats = await peerConnection.current.getStats();
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

        if (socket.current) {
          socket.current.on('offer', async (offer: RTCSessionDescriptionInit) => {
            if (!peerConnection.current) return;
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.current.createAnswer();
            await peerConnection.current.setLocalDescription(answer);
            socket.current?.emit('answer', answer, 'room-id');
          });

          socket.current.on('answer', async (answer: RTCSessionDescriptionInit) => {
            if (!peerConnection.current) return;
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
          });

          socket.current.on('ice-candidate', async (candidate: RTCIceCandidateInit) => {
            if (!peerConnection.current) return;
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
          });
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
      }
    };

    initStream();

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
      socket.current?.disconnect();
      peerConnection.current?.close();
    };
  }, [fps, quality]);

  const handleCreateRoom = async () => {
    const roomId = Math.random().toString(36).substring(2, 10);
    socket.current?.emit('create-room', roomId);
    alert(`Room created: ${roomId}`);

    if (peerConnection.current && socket.current) {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket.current.emit('offer', offer, roomId);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-4">Video Stream Room</h1>
        <button className="btn btn-primary" onClick={handleCreateRoom}>
          Create Room
        </button>
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
      </div>
    </div>
  );
};

export default StreamRoom;