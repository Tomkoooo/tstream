'use client';

import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import { useParams, useSearchParams } from 'next/navigation';

interface StreamStats {
  fps: number;
  droppedFrames: number;
  bitrate: number;
}

const AdminRoom: React.FC = () => {
  const videoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const [roomName, setRoomName] = useState<string>('');
  const [shareLink, setShareLink] = useState<string>('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [stats, setStats] = useState<Map<string, StreamStats>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [showKickConfirm, setShowKickConfirm] = useState<string | null>(null);
  const socket = useRef<Socket | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const name = searchParams.get('name') || `Room-${roomId}`;
    const password = searchParams.get('password') || '';
    if (!password) {
      setError('No password provided in URL');
      return;
    }

    setRoomName(decodeURIComponent(name));
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    setShareLink(`${baseUrl}/join/${roomId}`);

    socket.current = io({ path: '/api/socket', transports: ['websocket'] });

    // Admin csatlakozás
    socket.current?.emit('join-room', roomId, decodeURIComponent(password), (success: boolean, errorMsg?: string) => {
      if (!success) {
        setError(errorMsg || 'Failed to join room as admin');
      } else {
        console.log('Admin successfully joined room:', roomId);
      }
    });

    // Kick sikeres esemény kezelése
    socket.current?.on('kick-success', (targetId: string) => {
      console.log(`Successfully kicked user: ${targetId}`);
      setSuccess(`User ${targetId.slice(0, 8)} has been kicked`);
    });

    const initWebRTC = (participantId: string) => {
      if (peerConnections.current.has(participantId)) {
        console.log(`WebRTC connection already exists for ${participantId}`);
        return;
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      pc.ontrack = (event) => {
        console.log(`Received track from ${participantId}`);
        const videoEl = videoRefs.current.get(participantId);
        if (videoEl && !videoEl.srcObject) {
          videoEl.srcObject = event.streams[0];
          videoEl.play().catch(err => {
            console.error(`Error playing video for ${participantId}:`, err);
          });
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && socket.current) {
          console.log(`Sending ICE candidate to ${participantId}`);
          socket.current.emit('ice-candidate', event.candidate, roomId, socket.current.id);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`ICE state for ${participantId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          console.log(`Reconnecting to ${participantId}...`);
          pc.restartIce();
        }
      };

      peerConnections.current.set(participantId, pc);
      console.log(`WebRTC connection initialized for ${participantId}`);

      const updateStats = async () => {
        try {
          const currentStats = await pc.getStats();
          let currentFps = 0;
          let droppedFrames = 0;
          let currentBitrate = 0;

          currentStats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              currentFps = report.framesPerSecond || 0;
              droppedFrames = report.framesDropped || 0;
              currentBitrate = report.bytesReceived ? (report.bytesReceived * 8) / 1000 : 0;
            }
          });

          setStats((prev) => new Map(prev).set(participantId, { 
            fps: currentFps, 
            droppedFrames, 
            bitrate: currentBitrate 
          }));
        } catch (err) {
          console.error(`Error updating stats for ${participantId}:`, err);
        }
      };

      const statsInterval = setInterval(updateStats, 1000);
      return () => clearInterval(statsInterval);
    };

    socket.current?.on('user-joined', (participantId: string) => {
      if (participantId !== socket.current?.id) {
        console.log(`New participant joined: ${participantId}`);
        initWebRTC(participantId);
      }
    });

    socket.current?.on('participants', (participantIds: string[]) => {
      console.log('Participants update:', participantIds);
      setParticipants(participantIds.filter((id) => id !== socket.current?.id));
    });

    socket.current?.on('offer', async (offer: RTCSessionDescriptionInit, fromSocketId: string) => {
      if (fromSocketId === socket.current?.id) return;
      
      let pc = peerConnections.current.get(fromSocketId);
      if (!pc) {
        console.log(`Creating new peer connection for ${fromSocketId}`);
        initWebRTC(fromSocketId);
        pc = peerConnections.current.get(fromSocketId);
      }

      try {
        console.log(`Processing offer from ${fromSocketId}`);
        await pc?.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc?.createAnswer();
        await pc?.setLocalDescription(answer);
        console.log(`Sending answer to ${fromSocketId}`);
        socket.current?.emit('answer', answer, roomId, socket.current.id);
      } catch (err) {
        console.error('Failed to process WebRTC offer:', err);
        setError('Nem sikerült feldolgozni a WebRTC ajánlatot');
      }
    });

    socket.current?.on('answer', async (answer: RTCSessionDescriptionInit, fromSocketId: string) => {
      const pc = peerConnections.current.get(fromSocketId);
      if (pc) {
        try {
          console.log(`Processing answer from ${fromSocketId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log(`Answer processed successfully for ${fromSocketId}`);
        } catch (err) {
          console.error('Failed to process WebRTC answer:', err);
          setError('Nem sikerült feldolgozni a WebRTC választ');
        }
      }
    });

    socket.current?.on('ice-candidate', async (candidate: RTCIceCandidateInit, fromSocketId: string) => {
      const pc = peerConnections.current.get(fromSocketId);
      if (pc) {
        try {
          console.log(`Adding ICE candidate from ${fromSocketId}`);
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`ICE candidate added successfully for ${fromSocketId}`);
        } catch (err) {
          console.error(`Error adding ICE candidate from ${fromSocketId}:`, err);
        }
      }
    });

    socket.current?.on('user-left', (participantId: string) => {
      console.log(`User left: ${participantId}`);
      const pc = peerConnections.current.get(participantId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(participantId);
      }
      videoRefs.current.delete(participantId);
      setStats((prev) => {
        const newStats = new Map(prev);
        newStats.delete(participantId);
        return newStats;
      });
      if (fullscreenId === participantId) {
        setFullscreenId(null);
      }
    });

    return () => {
      console.log('Cleaning up admin room...');
      socket.current?.disconnect();
      peerConnections.current.forEach((pc) => {
        pc.close();
      });
      peerConnections.current.clear();
      videoRefs.current.clear();
    };
  }, [roomId, searchParams]);

  const copyLinkToClipboard = () => {
    navigator.clipboard.writeText(shareLink);
    alert('Link copied to clipboard!');
  };

  const toggleFullscreen = (id: string) => {
    setFullscreenId(fullscreenId === id ? null : id);
  };

  const handleKickUser = (participantId: string) => {
    if (socket.current && roomId) {
      console.log('Kick request:', {
        roomId,
        targetId: participantId,
        adminId: socket.current.id
      });
      socket.current.emit('kick-user', roomId, participantId);
      setShowKickConfirm(null);
    }
  };

  return (
    <div className="container mx-auto p-6 bg-base-200 min-h-screen">
      <div className="card bg-base-100 shadow-xl p-6 mb-6">
        <h1 className="text-3xl font-bold text-center mb-4">{roomName}</h1>
        {error && <div className="alert alert-error mb-4"><span>{error}</span></div>}
        {success && <div className="alert alert-success mb-4"><span>{success}</span></div>}
        <div className="flex justify-center mb-4">
          <div className="form-control w-full max-w-md">
            <label className="label"><span className="label-text">Share Link</span></label>
            <div className="input-group">
              <input type="text" value={shareLink} readOnly className="input input-bordered w-full" />
              <button className="btn btn-primary" onClick={copyLinkToClipboard}>Copy</button>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          {fullscreenId ? (
            <div className="card bg-base-100 shadow-xl p-4">
              <div className="card-body">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="card-title">User {fullscreenId.slice(0, 8)}</h2>
                  <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setFullscreenId(null)}>✕</button>
                </div>
                <video
                  ref={(el) => {videoRefs.current.set(fullscreenId, el)}}
                  autoPlay
                  className="w-full h-[calc(100vh-200px)] rounded-lg"
                />
                <div className="stats bg-base-300 mt-2">
                  <div className="stat">
                    <div className="stat-title">FPS</div>
                    <div className="stat-value text-sm">{stats.get(fullscreenId)?.fps || 0}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Dropped Frames</div>
                    <div className="stat-value text-sm">{stats.get(fullscreenId)?.droppedFrames || 0}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Bitrate (kbps)</div>
                    <div className="stat-value text-sm">{stats.get(fullscreenId)?.bitrate || 0}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {participants.map((id) => (
                <div key={id} className="card bg-base-100 shadow-xl p-4">
                  <div className="card-body">
                    <div className="flex justify-between items-center mb-2">
                      <h2 className="card-title">User {id.slice(0, 8)}</h2>
                      <div className="flex gap-2">
                        <button className="btn btn-sm btn-primary" onClick={() => toggleFullscreen(id)}>
                          Fullscreen
                        </button>
                        <button 
                          className="btn btn-sm btn-error"
                          onClick={() => setShowKickConfirm(id)}
                        >
                          Kick
                        </button>
                      </div>
                    </div>
                    <video
                      ref={(el) => {videoRefs.current.set(id, el)}}
                      autoPlay
                      className="w-full rounded-lg"
                    />
                    <div className="stats bg-base-300 mt-2">
                      <div className="stat">
                        <div className="stat-title">FPS</div>
                        <div className="stat-value text-sm">{stats.get(id)?.fps || 0}</div>
                      </div>
                      <div className="stat">
                        <div className="stat-title">Dropped Frames</div>
                        <div className="stat-value text-sm">{stats.get(id)?.droppedFrames || 0}</div>
                      </div>
                      <div className="stat">
                        <div className="stat-title">Bitrate (kbps)</div>
                        <div className="stat-value text-sm">{stats.get(id)?.bitrate || 0}</div>
                      </div>
                    </div>
                  </div>
                  {showKickConfirm === id && (
                    <div className="mt-2 p-2 bg-base-200 rounded-lg">
                      <p className="text-sm mb-2">Are you sure you want to kick this user?</p>
                      <div className="flex gap-2">
                        <button 
                          className="btn btn-sm btn-error"
                          onClick={() => handleKickUser(id)}
                        >
                          Yes, kick
                        </button>
                        <button 
                          className="btn btn-sm"
                          onClick={() => setShowKickConfirm(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card bg-base-100 shadow-xl p-4">
          <h2 className="text-xl font-bold mb-4">Participants</h2>
          <ul className="menu bg-base-300 rounded-box">
            {participants.map((id) => (
              <li key={id}>
                <a className="truncate">User {id.slice(0, 8)}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AdminRoom;