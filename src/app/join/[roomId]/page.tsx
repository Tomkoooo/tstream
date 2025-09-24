'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { useParams } from 'next/navigation';
import { 
  IconVideo, 
  IconCamera, 
  IconMicrophone,
  IconSettings,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconLogout,
  IconRotate,
  IconFlipHorizontal,
  IconFlipVertical,
  IconArrowLeft
} from '@tabler/icons-react';

interface Participant {
  id: string;
  isAdmin: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  streamSettings: {
    resolution: string;
    fps: number;
    bitrate: number;
  };
}

interface StreamSettings {
  resolution: '480p' | '720p' | '1080p';
  fps: number;
  bitrate: number;
  audioEnabled: boolean;
}

interface VideoDevice {
  deviceId: string;
  label: string;
}

interface AudioDevice {
  deviceId: string;
  label: string;
}

const JoinRoom: React.FC = () => {
  const params = useParams();
  const roomId = params?.roomId as string;
  
  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // States
  const [password, setPassword] = useState<string>('');
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  // Device states
  const [videoDevices, setVideoDevices] = useState<VideoDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isWaitingForAdmin, setIsWaitingForAdmin] = useState<boolean>(false);
  
  // Stream settings
  const [streamSettings, setStreamSettings] = useState<StreamSettings>({
    resolution: '720p',
    fps: 30,
    bitrate: 2000,
    audioEnabled: true
  });
  
  // Visual settings
  const [rotation, setRotation] = useState<number>(0);
  const [flip, setFlip] = useState<'none' | 'horizontal' | 'vertical'>('none');

  // Eszközök lekérése
  const getDevices = useCallback(async () => {
    try {
      // Engedélyek kérése
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const videoInputs = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 8)}`
        }));
        
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`
        }));
      
      setVideoDevices(videoInputs);
      setAudioDevices(audioInputs);
      
      // Csak akkor állítsuk be az alapértelmezett eszközöket, ha még nincsenek beállítva
      if (videoInputs.length > 0) {
        setSelectedVideoDevice(prev => prev || videoInputs[0].deviceId);
      }
      
      if (audioInputs.length > 0) {
        setSelectedAudioDevice(prev => prev || audioInputs[0].deviceId);
      }
      
    } catch (err) {
      console.error('Error getting devices:', err);
      setError('Nem sikerült hozzáférni a kamerához és mikrofonhoz. Ellenőrizd az engedélyeket.');
    }
  }, []);

  // Socket kapcsolat inicializálása
  useEffect(() => {
    if (!roomId) return;

    socketRef.current = io({
      path: '/api/socket',
      transports: ['websocket'],
      forceNew: true
    });

    const socket = socketRef.current;

    // Socket események
    socket.on('connect', () => {
      console.log('Connected to server:', socket.id);
    });

    socket.on('user-joined', (data) => {
      console.log('User joined:', data);
      if (data.userId !== socket.id) {
        // Peer connection létrehozása és offer küldése ha streamelünk
        if (isStreaming && localStreamRef.current) {
          console.log('Admin joined while streaming, creating peer connection');
          const pc = createPeerConnection(data.userId);
          
          // Stream hozzáadása a peer connection-höz
          console.log('Adding stream to peer connection for new admin:', data.userId);
          localStreamRef.current.getTracks().forEach(track => {
            console.log('Adding track:', track.kind);
            pc.addTrack(track, localStreamRef.current!);
          });
          
          // Offer küldése
          setTimeout(async () => {
            try {
              if (pc.signalingState === 'stable') {
                console.log('Sending offer to new admin:', data.userId);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                if (socketRef.current) {
                  socketRef.current.emit('offer', {
                    offer,
                    roomId,
                    targetId: data.userId
                  });
                }
          }
        } catch (err) {
              console.error('Error sending offer to new user:', err);
            }
          }, 100);
        } else {
          console.log('Not streaming or no stream available when admin joined');
        }
      }
    });

    socket.on('user-left', (userId) => {
      console.log('User left:', userId);
      closePeerConnection(userId);
    });

    socket.on('participants-updated', (updatedParticipants: Participant[]) => {
      console.log('Participants updated:', updatedParticipants);
      setParticipants(updatedParticipants);
    });

    socket.on('offer', async (data) => {
      await handleOffer(data);
    });

    socket.on('answer', async (data) => {
      await handleAnswer(data);
    });

    socket.on('ice-candidate', async (data) => {
      await handleIceCandidate(data);
    });

    socket.on('kicked', () => {
      setError('Ki lettél rúgva a szobából');
      leaveRoom();
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server, reason:', reason);
      setError(`Kapcsolat megszakadt: ${reason}`);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setError(`Kapcsolódási hiba: ${error.message}`);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setError(`Socket hiba: ${error}`);
    });

    // Eszközök lekérése
    getDevices();

    return () => {
      socket.disconnect();
      cleanupConnections();
    };
  }, [roomId]);

  // WebRTC peer connection létrehozása
  const createPeerConnection = useCallback((targetId: string) => {
    if (peerConnectionsRef.current.has(targetId)) {
      console.log('♻️ Reusing existing peer connection for:', targetId);
      return peerConnectionsRef.current.get(targetId)!;
    }

    console.log('🆕 Creating new peer connection for:', targetId);

    const pc = new RTCPeerConnection({
      iceServers: [
        // Google STUN szerverek
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        
        // Alternatív STUN szerverek
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.nextcloud.com:443' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        
        // Ingyenes TURN szerverek
        { 
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        { 
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject', 
          credential: 'openrelayproject'
        },
        { 
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    // Local stream hozzáadása (csak új connection esetén)
    if (localStreamRef.current) {
      console.log('🎵 Adding tracks to new peer connection:', localStreamRef.current.getTracks().length);
      localStreamRef.current.getTracks().forEach((track, index) => {
        console.log(`➕ Adding track ${index}:`, track.kind, track.enabled);
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // ICE candidate kezelés
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          roomId: params?.roomId as string,
          targetId
        });
      }
    };

    // Connection state változások
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${targetId}:`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${targetId}:`, pc.connectionState);
    };

    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }, []);

  // Offer kezelése
  const handleOffer = useCallback(async (data: { offer: RTCSessionDescriptionInit, fromId: string, roomId: string }) => {
    try {
      console.log('📨 Received offer from admin:', data.fromId);
      
      if (!localStreamRef.current) {
        console.warn('❌ No local stream available');
        console.log('isStreaming:', isStreaming, 'localStream:', !!localStreamRef.current);
        return;
      }
      
      console.log('✅ Local stream available, proceeding with offer handling');
      
      // Ellenőrizzük hogy van-e már peer connection
      let pc = peerConnectionsRef.current.get(data.fromId);
      if (!pc) {
        console.log('🆕 Creating peer connection for offer from:', data.fromId);
        pc = createPeerConnection(data.fromId);
      } else {
        console.log('♻️ Using existing peer connection for:', data.fromId);
      }
      
      if (!pc) {
        console.error('Failed to get peer connection');
        return;
      }
      
      console.log('📹 Local stream tracks available:', localStreamRef.current.getTracks().length);
      
      // Remote description beállítása
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      console.log('✅ Set remote description successfully');
      
      // Pending ICE candidates feldolgozása
      const pendingCandidates = pendingCandidatesRef.current.get(data.fromId) || [];
      console.log('🧊 Processing pending ICE candidates:', pendingCandidates.length);
      for (const candidate of pendingCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current.delete(data.fromId);
      
      // Answer létrehozása és küldése
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('📤 Sending answer to admin:', data.fromId);
      
      if (socketRef.current) {
        socketRef.current.emit('answer', {
          answer,
          roomId: data.roomId,
          targetId: data.fromId
        });
      }
      
      setSuccess('Kapcsolódva az adminhoz! 🎉');
      setIsWaitingForAdmin(false);
      
    } catch (err) {
      console.error('❌ Error handling offer:', err);
      setError('Hiba történt a kapcsolat létrehozása során');
    }
  }, [createPeerConnection, isStreaming]);

  // Answer kezelése
  const handleAnswer = useCallback(async (data: { answer: RTCSessionDescriptionInit, fromId: string }) => {
    try {
      const pc = peerConnectionsRef.current.get(data.fromId);
      if (pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        
        // Pending ICE candidates feldolgozása
        const pendingCandidates = pendingCandidatesRef.current.get(data.fromId) || [];
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current.delete(data.fromId);
      }
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  }, []);

  // ICE candidate kezelése
  const handleIceCandidate = useCallback(async (data: { candidate: RTCIceCandidateInit, fromId: string }) => {
    try {
      const pc = peerConnectionsRef.current.get(data.fromId);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        // Pending candidates tárolása
        const pending = pendingCandidatesRef.current.get(data.fromId) || [];
        pending.push(data.candidate);
        pendingCandidatesRef.current.set(data.fromId, pending);
      }
    } catch (err) {
      console.error('Error handling ICE candidate:', err);
    }
  }, []);

  // Szobához csatlakozás
  const joinRoom = useCallback(() => {
    if (!password.trim()) {
      setError('Jelszó megadása kötelező');
      return;
    }

    setIsLoading(true);
    setError(null);

    if (socketRef.current) {
      socketRef.current.emit('join-room', roomId, password, (response: { success: boolean, error?: string, isAdmin?: boolean }) => {
      setIsLoading(false);
        
        if (response.success) {
          setIsJoined(true);
          setSuccess('Sikeresen csatlakoztál a szobához!');
        } else {
          setError(response.error || 'Sikertelen csatlakozás');
        }
      });
    }
  }, [roomId, password]);

  // Stream indítása
  const startStream = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Korábbi stream leállítása
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      // Constraints összeállítása
      const resolutionMap = {
        '480p': { width: 854, height: 480 },
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 }
      };

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined,
          ...resolutionMap[streamSettings.resolution],
          frameRate: { ideal: streamSettings.fps }
        },
        audio: streamSettings.audioEnabled ? {
          deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      console.log('🎥 Local stream created with tracks:', stream.getTracks().length);

      // Local video megjelenítése
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Bitráta beállítása
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const sender = peerConnectionsRef.current.values();
        for (const pc of sender) {
          const senders = pc.getSenders();
          const videoSender = senders.find(s => s.track?.kind === 'video');
          if (videoSender) {
            const params = videoSender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = streamSettings.bitrate * 1000;
            await videoSender.setParameters(params);
          }
        }
      }

      // Meglévő peer connectionökhöz stream hozzáadása
      for (const [targetId, pc] of peerConnectionsRef.current.entries()) {
        try {
          // Korábbi trackok eltávolítása
          pc.getSenders().forEach(sender => {
            if (sender.track) {
              pc.removeTrack(sender);
            }
          });

          // Új trackok hozzáadása
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
          });

          // Új offer küldése csak ha a peer connection stabil állapotban van
          if (pc.signalingState === 'stable' && socketRef.current) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socketRef.current.emit('offer', {
              offer,
              roomId,
              targetId
            });
          }
        } catch (err) {
          console.error(`Error updating stream for ${targetId}:`, err);
        }
      }

      // Stream állapot frissítése a szerveren
      if (socketRef.current) {
        socketRef.current.emit('update-stream-status', roomId, {
          hasVideo: true,
          hasAudio: streamSettings.audioEnabled
        });

        socketRef.current.emit('update-stream-settings', roomId, streamSettings);
      }

      setIsStreaming(true);
      setIsWaitingForAdmin(true);
      console.log('✅ Stream state updated: isStreaming=true, localStream=', !!localStreamRef.current);
      setSuccess('Stream sikeresen elindítva! Várakozás az admin csatlakozására...');
      
      // Csak jelezzük a szervernek hogy streamelünk - az admin fog kezdeményezni
      console.log('Stream started, waiting for admin to connect...');

    } catch (err) {
      console.error('Error starting stream:', err);
      setError('Nem sikerült elindítani a streamet. Ellenőrizd a kamera és mikrofon engedélyeket.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedVideoDevice, selectedAudioDevice, streamSettings, roomId]);

  // Stream leállítása
  const stopStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    // Stream állapot frissítése a szerveren
    if (socketRef.current) {
      socketRef.current.emit('update-stream-status', roomId, {
        hasVideo: false,
        hasAudio: false
      });
    }

    setIsStreaming(false);
    setSuccess('Stream leállítva');
  }, [roomId]);

  // Stream beállítások frissítése
  const updateStreamSettings = useCallback(async () => {
    if (!isStreaming) return;
    
    setIsLoading(true);
    try {
      await startStream(); // Újraindítjuk a streamet az új beállításokkal
    } finally {
      setIsLoading(false);
    }
  }, [isStreaming, startStream]);

  // Szoba elhagyása
  const leaveRoom = useCallback(() => {
    stopStream();
    cleanupConnections();
    
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    setIsJoined(false);
    setPassword('');
    setSuccess('Sikeresen elhagytad a szobát');
  }, [stopStream]);

  // Kapcsolatok tisztítása
  const cleanupConnections = useCallback(() => {
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
  }, []);

  // Peer connection bezárása
  const closePeerConnection = useCallback((targetId: string) => {
    const pc = peerConnectionsRef.current.get(targetId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(targetId);
    }
    pendingCandidatesRef.current.delete(targetId);
  }, []);

  // Render
  return (
    <div className="min-h-screen bg-base-100">
      {/* Navigation */}
      <div className="navbar bg-base-200 shadow-sm">
        <div className="navbar-start">
          <button 
            onClick={() => window.history.back()}
            className="btn btn-ghost btn-sm"
          >
            <IconArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
        <div className="navbar-center">
          <div className="flex items-center gap-2">
            <IconVideo className="w-6 h-6 text-primary" />
            <span className="text-lg font-bold">tStream</span>
          </div>
        </div>
        <div className="navbar-end">
          <div className="badge badge-primary">Room: {roomId}</div>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Join Room
          </h1>
          <p className="text-base-content/70">Room ID: {roomId}</p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="alert alert-error mb-6">
            <IconRefresh className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="alert alert-success mb-6">
            <IconVideo className="w-5 h-5" />
            <span>{success}</span>
          </div>
        )}

        {isWaitingForAdmin && (
          <div className="alert alert-info mb-6">
            <span className="loading loading-spinner loading-sm"></span>
            <span>Waiting for admin to connect...</span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center mb-6">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        )}

      {!isJoined ? (
          /* Join Form */
          <div className="card bg-base-100 shadow-xl border border-base-300 max-w-md mx-auto">
            <div className="card-body">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-primary/10">
                  <IconVideo className="w-6 h-6 text-primary" />
                </div>
                <h2 className="card-title text-xl">Join Room</h2>
              </div>
              
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Room Password</span>
                </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
                  className="input input-bordered input-lg"
            placeholder="Enter room password"
            disabled={isLoading}
                  onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                />
                <label className="label">
                  <span className="label-text-alt text-base-content/60">
                    Required to join this room
                  </span>
                </label>
        </div>

              <div className="card-actions justify-center mt-6">
                <button
                  onClick={joinRoom}
                  disabled={isLoading || !password.trim()}
                  className="btn btn-primary btn-lg btn-wide"
                >
                  {isLoading ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Joining...
                    </>
                  ) : (
                    <>
                      Join Room
                      <IconVideo className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Streaming Interface */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Video Preview */}
            <div className="lg:col-span-2">
              <div className="card bg-base-100 shadow-xl border border-base-300">
                <div className="card-body">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <IconCamera className="w-5 h-5 text-primary" />
                    </div>
                    <h2 className="card-title">
                      {isStreaming ? 'Live Stream' : 'Camera Preview'}
                    </h2>
                  </div>
                  
                  <div className="relative bg-black rounded-lg overflow-hidden">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-auto"
                      style={{
                        transform: `rotate(${rotation}deg) ${
                          flip === 'horizontal' ? 'scaleX(-1)' : ''
                        } ${flip === 'vertical' ? 'scaleY(-1)' : ''}`
                      }}
                    />
                    
                    {!isStreaming && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="text-center text-white">
                          <IconCamera className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p className="text-lg mb-2">Stream not started</p>
                          <p className="text-sm opacity-75">
                            Configure settings and start streaming
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stream Controls */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {!isStreaming ? (
                      <button
                        onClick={startStream}
                        disabled={isLoading}
                        className="btn btn-success flex-1 min-w-0"
                      >
                        {isLoading ? (
                          <>
                            <span className="loading loading-spinner loading-sm"></span>
                            Starting...
                          </>
                        ) : (
                          <>
                            <IconPlayerPlay className="w-4 h-4" />
                            Start Stream
                          </>
                        )}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={stopStream}
                          disabled={isLoading}
                          className="btn btn-error flex-1 min-w-0"
                        >
                          {isLoading ? (
                            <>
                              <span className="loading loading-spinner loading-sm"></span>
                              Stopping...
                            </>
                          ) : (
                          <>
                            <IconPlayerStop className="w-4 h-4" />
                            Stop Stream
                          </>
                          )}
                        </button>
                        <button
                          onClick={updateStreamSettings}
                          disabled={isLoading}
                          className="btn btn-warning"
                        >
                          <IconRefresh className="w-4 h-4" />
                          Update Settings
                        </button>
                      </>
                    )}
                    
                    <button
                      onClick={leaveRoom}
                      className="btn btn-outline btn-error"
                    >
                      <IconLogout className="w-4 h-4" />
                      Leave Room
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Settings Panel */}
            <div className="space-y-4">
              
              {/* Device Selection */}
              <div className="card bg-base-100 shadow-xl border border-base-300">
                <div className="card-body">
                  <div className="flex items-center gap-2 mb-4">
                    <IconSettings className="w-5 h-5 text-primary" />
                    <h3 className="card-title text-lg">Devices</h3>
                  </div>
                  
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Camera</span>
                    </label>
                    <select
                      value={selectedVideoDevice}
                      onChange={(e) => setSelectedVideoDevice(e.target.value)}
                      className="select select-bordered"
                      disabled={isStreaming}
                    >
                      {videoDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Microphone</span>
                    </label>
                    <select
                      value={selectedAudioDevice}
                      onChange={(e) => setSelectedAudioDevice(e.target.value)}
                      className="select select-bordered"
                      disabled={isStreaming}
                    >
                      {audioDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Stream Settings */}
              <div className="card bg-base-100 shadow-xl border border-base-300">
                <div className="card-body">
                  <div className="flex items-center gap-2 mb-4">
                    <IconVideo className="w-5 h-5 text-secondary" />
                    <h3 className="card-title text-lg">Stream Settings</h3>
                  </div>
                  
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Resolution</span>
                    </label>
                    <select
                      value={streamSettings.resolution}
                      onChange={(e) => setStreamSettings(prev => ({
                        ...prev,
                        resolution: e.target.value as '480p' | '720p' | '1080p'
                      }))}
                      className="select select-bordered"
                    >
                      <option value="480p">480p (854×480)</option>
                      <option value="720p">720p (1280×720)</option>
                      <option value="1080p">1080p (1920×1080)</option>
                    </select>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">FPS: {streamSettings.fps}</span>
                    </label>
                    <input
                      type="range"
                      min={15}
                      max={60}
                      value={streamSettings.fps}
                      onChange={(e) => setStreamSettings(prev => ({
                        ...prev,
                        fps: Number(e.target.value)
                      }))}
                      className="range range-primary"
                    />
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Bitrate: {streamSettings.bitrate} kbps</span>
                    </label>
                    <input
                      type="range"
                      min={500}
                      max={8000}
                      value={streamSettings.bitrate}
                      onChange={(e) => setStreamSettings(prev => ({
                        ...prev,
                        bitrate: Number(e.target.value)
                      }))}
                      className="range range-primary"
                    />
                  </div>

                  <div className="form-control">
                    <label className="cursor-pointer label">
                      <span className="label-text font-medium">Enable Audio</span>
                      <input
                        type="checkbox"
                        checked={streamSettings.audioEnabled}
                        onChange={(e) => setStreamSettings(prev => ({
                          ...prev,
                          audioEnabled: e.target.checked
                        }))}
                        className="checkbox checkbox-primary"
                      />
                    </label>
                  </div>
              </div>
              </div>

              {/* Visual Settings */}
              <div className="card bg-base-100 shadow-xl border border-base-300">
                <div className="card-body">
                  <div className="flex items-center gap-2 mb-4">
                    <IconRotate className="w-5 h-5 text-accent" />
                    <h3 className="card-title text-lg">Visual Settings</h3>
                  </div>
                  
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Rotation</span>
                    </label>
                    <select
                      value={rotation}
                      onChange={(e) => setRotation(Number(e.target.value))}
                      className="select select-bordered"
                    >
                      <option value={0}>0°</option>
                      <option value={90}>90°</option>
                      <option value={180}>180°</option>
                      <option value={270}>270°</option>
                    </select>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Flip</span>
                    </label>
                    <select
                      value={flip}
                      onChange={(e) => setFlip(e.target.value as 'none' | 'horizontal' | 'vertical')}
                      className="select select-bordered"
                    >
                      <option value="none">None</option>
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
    </div>
  );
};

export default JoinRoom;