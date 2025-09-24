'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { useParams, useSearchParams } from 'next/navigation';
import { 
  IconVideo, 
  IconRefresh,
  IconEye,
  IconEyeOff,
  IconMaximize,
  IconPlayerStop,
  IconSettings,
  IconArrowLeft
} from '@tabler/icons-react';

interface StreamStats {
  fps: number;
  bitrate: number;
  droppedFrames: number;
  packetLoss: number;
  timestamp: number;
}

const SingleCameraView: React.FC = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const participantId = params?.participantId as string;
  const roomId = searchParams.get('roomId');
  const password = searchParams.get('password') || '';
  
  // Transform beállítások URL paraméterekből
  const flipH = searchParams.get('flipH') === '1';
  const flipV = searchParams.get('flipV') === '1';
  const rotation = parseInt(searchParams.get('rotation') || '0');
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // States
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStats, setStreamStats] = useState<StreamStats>({
    fps: 0,
    bitrate: 0,
    droppedFrames: 0,
    packetLoss: 0,
    timestamp: 0
  });
  const [showStats, setShowStats] = useState<boolean>(false);
  const [autoReconnect, setAutoReconnect] = useState<boolean>(true);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const maxReconnectAttempts = 5;

  // Socket és WebRTC inicializálása
  const initializeConnection = useCallback(async () => {
    if (!participantId || !roomId) {
      setError('Hiányzó paraméterek: participantId vagy roomId');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Socket kapcsolat
      socketRef.current = io({
        path: '/api/socket',
        transports: ['websocket'],
        forceNew: true,
        timeout: 10000
      });

      const socket = socketRef.current;

      socket.on('connect', () => {
        console.log('🔌 Connected to server for single camera view');
        console.log('📋 Parameters:', { participantId, roomId, password: password ? '***' : 'empty' });
        
        // Csatlakozás a szobához mint viewer
        socket.emit('join-room', roomId, password, (response: { success: boolean, error?: string }) => {
          if (response.success) {
            console.log('✅ Joined room as viewer');
            // Peer connection inicializálása csak amikor szükséges (participants-updated-ben)
            console.log('⏳ Waiting for streaming participants...');
          } else {
            console.error('❌ Failed to join room:', response.error);
            setError(response.error || 'Sikertelen csatlakozás a szobához');
            setIsLoading(false);
          }
        });
      });

      socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        setError('Kapcsolódási hiba a szerverhez');
        setIsLoading(false);
      });

      socket.on('disconnect', () => {
        console.log('Disconnected from server');
        setIsConnected(false);
        
        if (autoReconnect && reconnectAttempts < maxReconnectAttempts) {
          setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            initializeConnection();
          }, 2000 * (reconnectAttempts + 1)); // Exponential backoff
        }
      });

      socket.on('offer', handleOffer);
      socket.on('answer', handleAnswer);
      socket.on('ice-candidate', handleIceCandidate);

      // Participants frissítés figyelése
      socket.on('participants-updated', (participants: any[]) => {
        console.log('👥 Participants updated:', participants.length);
        const targetParticipant = participants.find(p => p.id === participantId);
        console.log('🎯 Target participant:', targetParticipant ? {
          id: targetParticipant.id.slice(0, 8),
          hasVideo: targetParticipant.hasVideo,
          hasAudio: targetParticipant.hasAudio
        } : 'not found');
        
        if (targetParticipant && targetParticipant.hasVideo) {
          console.log('🎥 Target participant is streaming!');
          if (!peerConnectionRef.current) {
            console.log('🔧 Initializing peer connection...');
            initializePeerConnection();
            // Kis késleltetés majd offer küldése
            setTimeout(() => {
              sendOfferToParticipant();
            }, 1000);
          } else {
            console.log('📤 Peer connection exists, sending offer...');
            sendOfferToParticipant();
          }
        } else if (!targetParticipant) {
          console.log('⚠️ Target participant not in room');
        } else if (!targetParticipant.hasVideo) {
          console.log('⚠️ Target participant not streaming');
        }
      });

      socket.on('user-left', (userId) => {
        if (userId === participantId) {
          setError('A streamelő elhagyta a szobát');
          cleanupConnection();
        }
      });

    } catch (err) {
      console.error('Error initializing connection:', err);
      setError('Hiba a kapcsolat inicializálásakor');
      setIsLoading(false);
    }
  }, [participantId, roomId, password, autoReconnect, reconnectAttempts]);

  // Peer connection inicializálása
  const initializePeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    // Stream fogadása
    pc.ontrack = (event) => {
      console.log('🎬 Received track from participant:', participantId);
      console.log('📺 Streams received:', event.streams.length);
      const stream = event.streams[0];
      streamRef.current = stream;
      
      // Kis késleltetés hogy a video elem teljesen betöltődjön
      setTimeout(() => {
        if (videoRef.current && stream) {
          console.log('🎥 Setting video srcObject for camera view');
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => {
            console.log('✅ Video playing successfully');
            setIsConnected(true);
            setIsLoading(false);
            setReconnectAttempts(0);
          }).catch(err => {
            console.error('❌ Error playing video:', err);
            setError('Hiba a videó lejátszásakor');
          });
        } else {
          console.error('❌ Video element or stream not available');
        }
      }, 200);
      
      // Statisztikák gyűjtésének indítása
      startStatsCollection();
    };

    // ICE candidate kezelés
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          roomId,
          targetId: participantId
        });
      }
    };

    // Connection state változások
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setIsConnected(true);
        setIsLoading(false);
      } else if (pc.iceConnectionState === 'failed') {
        console.log('ICE connection failed, attempting restart');
        pc.restartIce();
      } else if (pc.iceConnectionState === 'disconnected') {
        setIsConnected(false);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      
      if (pc.connectionState === 'failed' && autoReconnect) {
        setTimeout(() => {
          if (reconnectAttempts < maxReconnectAttempts) {
            setReconnectAttempts(prev => prev + 1);
            initializeConnection();
          } else {
            setError('Maximális újracsatlakozási kísérletek elérve');
          }
        }, 1000);
      }
    };

    peerConnectionRef.current = pc;

    // Várjuk hogy a participant streamelni kezdjen, majd mi küldjük az offer-t
    // (Hasonlóan az admin oldalhoz)
  }, [participantId, roomId, autoReconnect, reconnectAttempts]);

  // Offer küldése a participantnak
  const sendOfferToParticipant = useCallback(async () => {
    if (!peerConnectionRef.current || !socketRef.current) return;

    try {
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnectionRef.current.setLocalDescription(offer);
      
      socketRef.current.emit('offer', {
        offer,
        roomId,
        targetId: participantId
      });
      
      console.log('Offer sent to participant:', participantId);
    } catch (err) {
      console.error('Error sending offer:', err);
      setError('Hiba az offer küldésekor');
    }
  }, [participantId, roomId]);

  // Offer kezelése
  const handleOffer = useCallback(async (data: { offer: RTCSessionDescriptionInit, fromId: string }) => {
    if (data.fromId !== participantId || !peerConnectionRef.current) return;

    try {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
      
      // Pending ICE candidates feldolgozása
      for (const candidate of pendingCandidatesRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current = [];

      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);

      if (socketRef.current) {
        socketRef.current.emit('answer', {
          answer,
          roomId,
          targetId: participantId
        });
      }
    } catch (err) {
      console.error('Error handling offer:', err);
      setError('Hiba az offer feldolgozásakor');
    }
  }, [participantId, roomId]);

  // Answer kezelése
  const handleAnswer = useCallback(async (data: { answer: RTCSessionDescriptionInit, fromId: string }) => {
    if (data.fromId !== participantId || !peerConnectionRef.current) return;

    try {
      if (peerConnectionRef.current.signalingState === 'have-local-offer') {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        
        // Pending ICE candidates feldolgozása
        for (const candidate of pendingCandidatesRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current = [];
      }
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  }, [participantId]);

  // ICE candidate kezelése
  const handleIceCandidate = useCallback(async (data: { candidate: RTCIceCandidateInit, fromId: string }) => {
    if (data.fromId !== participantId) return;

    try {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        // Pending candidates tárolása
        pendingCandidatesRef.current.push(data.candidate);
      }
    } catch (err) {
      console.error('Error handling ICE candidate:', err);
    }
  }, [participantId]);

  // Statisztikák gyűjtése
  const startStatsCollection = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }

    statsIntervalRef.current = setInterval(async () => {
      if (!peerConnectionRef.current) return;

      try {
        const stats = await peerConnectionRef.current.getStats();
        let fps = 0;
        let bitrate = 0;
        let droppedFrames = 0;
        let packetLoss = 0;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || 0;
            droppedFrames = report.framesDropped || 0;
            bitrate = report.bytesReceived ? (report.bytesReceived * 8) / 1000 : 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const packetsLost = report.packetsLost || 0;
            const packetsSent = report.packetsSent || 1;
            packetLoss = (packetsLost / packetsSent) * 100;
          }
        });

        setStreamStats({
          fps,
          bitrate,
          droppedFrames,
          packetLoss,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('Error collecting stats:', err);
      }
    }, 1000);
  }, []);

  // Connection tisztítása
  const cleanupConnection = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    streamRef.current = null;
    pendingCandidatesRef.current = [];
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Újracsatlakozás
  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    cleanupConnection();
    setTimeout(initializeConnection, 1000);
  }, [initializeConnection]);

  // Inicializálás
  useEffect(() => {
    initializeConnection();
    
    return () => {
      cleanupConnection();
    };
  }, [initializeConnection]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 's' || event.key === 'S') {
        setShowStats(prev => !prev);
      } else if (event.key === 'r' || event.key === 'R') {
        reconnect();
      } else if (event.key === 'f' || event.key === 'F') {
        if (videoRef.current) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            videoRef.current.requestFullscreen();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [reconnect]);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      
      {/* Header - Only visible when there are errors or loading */}
      {(error || isLoading) && (
        <div className="bg-base-100 p-4 shadow-lg border-b border-base-300">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <IconVideo className="w-5 h-5 text-primary" />
                Camera View - {participantId?.slice(0, 8)}
              </h1>
              <button 
                onClick={() => window.history.back()}
                className="btn btn-ghost btn-sm"
              >
                <IconArrowLeft className="w-4 h-4" />
                Back
              </button>
            </div>
            
            {error && (
              <div className="alert alert-error mb-3">
                <IconRefresh className="w-5 h-5" />
                <span>{error}</span>
                {autoReconnect && reconnectAttempts < maxReconnectAttempts && (
                  <button onClick={reconnect} className="btn btn-sm btn-outline ml-2">
                    <IconRefresh className="w-4 h-4 mr-1" />
                    Reconnect
                  </button>
                )}
              </div>
            )}
            
            {isLoading && (
              <div className="flex items-center gap-3">
                <span className="loading loading-spinner loading-sm"></span>
                <span>
                  {!socketRef.current?.connected ? 'Connecting to server...' :
                   !isConnected ? 'Waiting for stream...' : 'Connecting...'}
                </span>
                {reconnectAttempts > 0 && (
                  <span className="text-sm opacity-70">
                    (Attempt: {reconnectAttempts}/{maxReconnectAttempts})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main video area */}
      <div className="flex-1 relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-contain bg-black"
          style={{ 
            maxHeight: '100vh',
            transform: `${flipH ? 'scaleX(-1) ' : ''}${flipV ? 'scaleY(-1) ' : ''}${rotation ? `rotate(${rotation}deg)` : ''}`.trim() || undefined
          }}
        />
        
        {/* No Video Overlay */}
        {!isConnected && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center text-white">
              <div className="flex justify-center mb-6">
                <div className="p-4 rounded-full bg-primary/20">
                  <IconVideo className="w-16 h-16 text-primary" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-3">No Video Stream</h2>
              <p className="text-lg opacity-70 mb-6">
                Waiting for stream from: {participantId?.slice(0, 8)}
              </p>
              <button onClick={reconnect} className="btn btn-primary btn-lg">
                <IconRefresh className="w-5 h-5 mr-2" />
                Reconnect
              </button>
            </div>
          </div>
        )}

        {/* Stats Overlay */}
        {showStats && isConnected && (
          <div className="absolute top-4 left-4 bg-black/90 text-white p-4 rounded-lg font-mono text-sm border border-white/20">
            <div className="flex items-center gap-2 mb-3">
              <IconSettings className="w-4 h-4" />
              <h3 className="font-bold">Stream Statistics</h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>FPS:</span>
                <span className="text-primary">{streamStats.fps.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span>Bitrate:</span>
                <span className="text-secondary">{streamStats.bitrate.toFixed(0)} kbps</span>
              </div>
              <div className="flex justify-between">
                <span>Dropped Frames:</span>
                <span className="text-warning">{streamStats.droppedFrames}</span>
              </div>
              <div className="flex justify-between">
                <span>Packet Loss:</span>
                <span className="text-error">{streamStats.packetLoss.toFixed(1)}%</span>
              </div>
              <div className="divider my-2"></div>
              <div className="text-xs opacity-70">
                <div>Participant: {participantId?.slice(0, 8)}</div>
                <div>Room: {roomId}</div>
              </div>
            </div>
          </div>
        )}

        {/* Connection Status */}
        <div className="absolute top-4 right-4">
          <div className={`badge ${isConnected ? 'badge-success' : 'badge-error'} gap-1`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-error'}`}></div>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        {/* Controls Overlay */}
        <div className="absolute bottom-4 right-4 bg-black/90 text-white p-4 rounded-lg text-xs border border-white/20">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <kbd className="kbd kbd-xs">S</kbd>
              <span>Toggle Stats</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="kbd kbd-xs">F</kbd>
              <span>Fullscreen</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="kbd kbd-xs">R</kbd>
              <span>Reconnect</span>
            </div>
          </div>
        </div>

        {/* Debug Settings Panel - Only in development */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute bottom-4 left-4 bg-black/90 text-white p-4 rounded-lg text-xs border border-white/20">
            <div className="flex items-center gap-2 mb-3">
              <IconSettings className="w-4 h-4" />
              <h4 className="font-bold">Debug Settings</h4>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showStats}
                  onChange={(e) => setShowStats(e.target.checked)}
                  className="checkbox checkbox-xs"
                />
                Show Statistics
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoReconnect}
                  onChange={(e) => setAutoReconnect(e.target.checked)}
                  className="checkbox checkbox-xs"
                />
                Auto Reconnect
              </label>
              <button onClick={reconnect} className="btn btn-xs btn-primary w-full">
                <IconRefresh className="w-3 h-3 mr-1" />
                Manual Reconnect
              </button>
            </div>
          </div>
        )}
      </div>

      {/* OBS Browser Source Info */}
      <div className="bg-base-100/10 text-white/70 text-center p-3 text-xs border-t border-white/10">
        <div className="flex items-center justify-center gap-2">
          <IconVideo className="w-4 h-4" />
          <span>OBS Browser Source URL:</span>
        </div>
        <div className="font-mono text-xs mt-1 opacity-80">
          {typeof window !== 'undefined' ? window.location.href : 'Loading...'}
        </div>
      </div>
    </div>
  );
};

export default SingleCameraView;
