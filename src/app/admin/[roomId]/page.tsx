'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { useParams, useSearchParams } from 'next/navigation';

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

interface StreamStats {
  fps: number;
  bitrate: number;
  droppedFrames: number;
  packetLoss: number;
}

const AdminRoom: React.FC = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params?.roomId as string;
  
  // Refs
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const videoRefsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const streamRefsRef = useRef<Map<string, MediaStream | null>>(new Map());
  const fullscreenWindowsRef = useRef<Map<string, Window | null>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());

  // States
  const [roomName, setRoomName] = useState<string>('');
  const [shareLink, setShareLink] = useState<string>('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showKickConfirm, setShowKickConfirm] = useState<string | null>(null);
  const [streamStats, setStreamStats] = useState<Map<string, StreamStats>>(new Map());
  const [selectedAudioSource, setSelectedAudioSource] = useState<string>('');
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [isFullscreenMode, setIsFullscreenMode] = useState<boolean>(false);
  const [participantSettings, setParticipantSettings] = useState<Map<string, {
    flipHorizontal: boolean;
    flipVertical: boolean;
    rotation: number;
  }>>(new Map());

  // Socket kapcsolat inicializálása
  useEffect(() => {
    if (!roomId) return;

    const name = searchParams.get('name') || `Room-${roomId}`;
    const password = searchParams.get('password') || '';
    
    if (!password) {
      setError('Hiányzó jelszó az URL-ben');
      return;
    }

    setRoomName(decodeURIComponent(name));
    
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    setShareLink(`${baseUrl}/join/${roomId}`);

    // Socket inicializálása
    socketRef.current = io({
      path: '/api/socket',
      transports: ['websocket'],
      forceNew: true
    });

    const socket = socketRef.current;

    // Socket események
    socket.on('connect', () => {
      console.log('Admin connected:', socket.id);
      
      // Először próbáljunk csatlakozni a szobához
      socket.emit('join-room', roomId, decodeURIComponent(password), (response: { success: boolean, error?: string, isAdmin?: boolean, participants?: Participant[] }) => {
        if (response.success) {
          console.log('Admin joined successfully');
          if (response.participants) {
            setParticipants(response.participants);
          }
        } else if (response.error === 'Room does not exist') {
          // Ha a szoba nem létezik, hozzuk létre
          console.log('Room does not exist, creating...');
          socket.emit('create-room', {
            roomId,
            name: decodeURIComponent(name),
            password: decodeURIComponent(password)
          }, (createResponse: { success: boolean, error?: string, roomId?: string }) => {
            if (createResponse.success) {
              console.log('Room created successfully');
              setParticipants([]);
            } else {
              setError(createResponse.error || 'Sikertelen szoba létrehozás');
            }
          });
      } else {
          setError(response.error || 'Sikertelen admin csatlakozás');
        }
      });
    });

    socket.on('user-joined', (data) => {
      console.log('User joined:', data);
      // Kliens maga fogja kezdeményezni a kapcsolatot amikor streamel
    });

    socket.on('user-left', (userId) => {
      console.log('User left:', userId);
      cleanupParticipant(userId);
    });

    socket.on('participants-updated', (updatedParticipants: Participant[]) => {
      console.log('Participants updated:', updatedParticipants);
      const filteredParticipants = updatedParticipants.filter(p => p.id !== socket.id);
      setParticipants(filteredParticipants);
      
      // ADMIN KEZDEMÉNYEZ - ha van streamelő kliens, csatlakozunk hozzá (kis késleltetéssel)
      filteredParticipants.forEach(participant => {
        if (participant.hasVideo && !peerConnectionsRef.current.has(participant.id)) {
          console.log('🎥 Client is streaming! Admin connecting to:', participant.id);
          // Kis késleltetés hogy a kliens teljesen felkészüljön
          setTimeout(() => {
            connectToStreamingClient(participant.id);
          }, 500);
        }
      });
    });

    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);

    socket.on('kick-success', (targetId) => {
      setSuccess(`Felhasználó ${targetId.slice(0, 8)} sikeresen kirúgva`);
      setShowKickConfirm(null);
    });

    socket.on('admin-assigned', () => {
      setSuccess('Te lettél az új admin');
    });

    socket.on('participant-settings-updated', (data) => {
      console.log('Participant settings updated:', data);
    });

    // Audio context inicializálása
    initializeAudioContext();

    return () => {
      socket.disconnect();
      cleanupAllConnections();
      cleanupAudioContext();
    };
  }, [roomId, searchParams]);

  // Audio context inicializálása
  const initializeAudioContext = useCallback(() => {
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (err) {
      console.error('Error initializing audio context:', err);
    }
  }, []);

  // Audio context tisztítása
  const cleanupAudioContext = useCallback(() => {
    audioSourcesRef.current.forEach(source => {
      source.disconnect();
    });
    audioSourcesRef.current.clear();
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  }, []);

  // Peer connection inicializálása (egyszerűsített)
  const initializePeerConnection = useCallback((participantId: string) => {
    if (peerConnectionsRef.current.has(participantId)) {
      console.log('Peer connection already exists for:', participantId);
      return peerConnectionsRef.current.get(participantId);
    }

    console.log('Creating new peer connection for:', participantId);

    try {
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

      // Stream fogadása
      pc.ontrack = (event) => {
        console.log('Received track from:', participantId, 'streams:', event.streams.length);
        const stream = event.streams[0];
        streamRefsRef.current.set(participantId, stream);
        
        // Várjunk egy kicsit, hogy a video elem létrejöjjön a DOM-ban
        setTimeout(() => {
          const videoEl = videoRefsRef.current.get(participantId);
          console.log('Setting stream for participant:', participantId, 'videoEl:', !!videoEl);
          if (videoEl && stream) {
            videoEl.srcObject = stream;
            videoEl.play().catch(err => console.error('Error playing video:', err));
          }
        }, 100);

        // Audio source létrehozása
        setTimeout(() => {
          if (audioContextRef.current && stream && stream.getAudioTracks().length > 0) {
            try {
              const audioSource = audioContextRef.current.createMediaStreamSource(stream);
              audioSourcesRef.current.set(participantId, audioSource);
              
              if (selectedAudioSource === participantId || !selectedAudioSource) {
                const destination = audioContextRef.current.destination;
                audioSource.connect(destination);
                setSelectedAudioSource(participantId);
              }
            } catch (err) {
              console.error('Error creating audio source:', err);
            }
          }
        }, 200);
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
        console.log(`ICE connection state with ${participantId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${participantId}:`, pc.connectionState);
      };

      // Statisztikák gyűjtése
      const statsInterval = setInterval(async () => {
        try {
          const stats = await pc.getStats();
          let fps = 0;
          let bitrate = 0;
          let droppedFrames = 0;
          let packetLoss = 0;

          stats.forEach((report) => {
            if (report.type === 'inbound-rtp') {
              if (report.kind === 'video') {
                fps = report.framesPerSecond || 0;
              droppedFrames = report.framesDropped || 0;
                bitrate = report.bytesReceived ? (report.bytesReceived * 8) / 1000 : 0;
              }
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              packetLoss = (report.packetsLost || 0) / (report.packetsSent || 1) * 100;
            }
          });

          setStreamStats(prev => new Map(prev.set(participantId, {
            fps,
            bitrate,
            droppedFrames,
            packetLoss
          })));
        } catch (err) {
          console.error('Error getting stats:', err);
        }
      }, 2000);

      // Cleanup function tárolása
      (pc as any).statsInterval = statsInterval;

      peerConnectionsRef.current.set(participantId, pc);
      return pc;
      
    } catch (err) {
      console.error('❌ Failed to create peer connection:', err);
      throw err;
    }
  }, [roomId, selectedAudioSource]);


  // Admin kezdeményez kapcsolatot streamelő klienssel
  const connectToStreamingClient = useCallback(async (clientId: string) => {
    try {
      console.log('🚀 Admin initiating connection to streaming client:', clientId);
      
      // Ellenőrizzük hogy már van-e kapcsolat
      if (peerConnectionsRef.current.has(clientId)) {
        console.log('⚠️ Connection already exists, skipping...');
        return;
      }
      
      // Peer connection létrehozása
      const pc = initializePeerConnection(clientId);
      if (!pc) {
        console.error('❌ Failed to create peer connection for client:', clientId);
        return;
      }
      
      console.log('✅ Peer connection created successfully for:', clientId);

      // Offer létrehozása és küldése
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);
      
      console.log('📤 Admin sending offer to client:', clientId);
      
      if (socketRef.current) {
        socketRef.current.emit('offer', {
          offer,
          roomId,
          targetId: clientId
        });
      }
      
    } catch (err) {
      console.error('❌ Error connecting to streaming client:', err);
    }
  }, [initializePeerConnection, roomId]);

  // Offer kezelése
  const handleOffer = useCallback(async (data: { offer: RTCSessionDescriptionInit, fromId: string, roomId: string }) => {
    try {
      console.log('Received offer from client:', data.fromId);
      let pc = peerConnectionsRef.current.get(data.fromId);
        if (!pc) {
        pc = initializePeerConnection(data.fromId);
      }

      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

      // Pending ICE candidates feldolgozása
      const pendingCandidates = pendingCandidatesRef.current.get(data.fromId) || [];
      for (const candidate of pendingCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current.delete(data.fromId);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

      if (socketRef.current) {
        socketRef.current.emit('answer', {
          answer,
          roomId: data.roomId,
          targetId: data.fromId
        });
      }
          } catch (err) {
      console.error('Error handling offer:', err);
    }
  }, [initializePeerConnection]);

  // Answer kezelése
  const handleAnswer = useCallback(async (data: { answer: RTCSessionDescriptionInit, fromId: string }) => {
    try {
      console.log('Received answer from client:', data.fromId);
      const pc = peerConnectionsRef.current.get(data.fromId);
      if (pc && pc.signalingState === 'have-local-offer') {
        console.log('Setting remote description for client:', data.fromId);
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

        // Pending ICE candidates feldolgozása
        const pendingCandidates = pendingCandidatesRef.current.get(data.fromId) || [];
        console.log('Processing pending ICE candidates:', pendingCandidates.length);
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current.delete(data.fromId);
        console.log('Answer processed successfully for client:', data.fromId);
      } else {
        console.log('No peer connection or wrong signaling state for client:', data.fromId, 'signalingState:', pc?.signalingState);
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

  // Participant tisztítása
  const cleanupParticipant = useCallback((participantId: string) => {
    console.log('🧹 Cleaning up participant:', participantId);
    
    // Peer connection bezárása
    const pc = peerConnectionsRef.current.get(participantId);
      if (pc) {
      if ((pc as any).statsInterval) {
        clearInterval((pc as any).statsInterval);
      }
      pc.close();
      peerConnectionsRef.current.delete(participantId);
      console.log('🔌 Peer connection closed and removed for:', participantId);
    }

    // Video ref eltávolítása
    videoRefsRef.current.delete(participantId);
    
    // Stream ref eltávolítása
    streamRefsRef.current.delete(participantId);

    // Audio source eltávolítása
    const audioSource = audioSourcesRef.current.get(participantId);
    if (audioSource) {
      audioSource.disconnect();
      audioSourcesRef.current.delete(participantId);
    }

    // Stats eltávolítása
    setStreamStats(prev => {
        const newStats = new Map(prev);
        newStats.delete(participantId);
        return newStats;
      });

    // Fullscreen window bezárása
    const fullscreenWindow = fullscreenWindowsRef.current.get(participantId);
    if (fullscreenWindow && !fullscreenWindow.closed) {
      fullscreenWindow.close();
    }
    fullscreenWindowsRef.current.delete(participantId);

    // Pending candidates eltávolítása
    pendingCandidatesRef.current.delete(participantId);

    // Ha ez volt a kiválasztott audio source, válasszunk másikat
    if (selectedAudioSource === participantId) {
      const remainingParticipants = participants.filter(p => p.id !== participantId && p.hasAudio);
      if (remainingParticipants.length > 0) {
        setSelectedAudioSource(remainingParticipants[0].id);
      } else {
        setSelectedAudioSource('');
      }
    }
  }, [participants, selectedAudioSource]);

  // Peer connection újraindítása
  const restartConnection = useCallback(async (clientId: string) => {
    console.log('🔄 Restarting connection to client:', clientId);
    
    // Régi kapcsolat tisztítása
    cleanupParticipant(clientId);
    
    // Kis késleltetés majd új kapcsolat
    setTimeout(() => {
      connectToStreamingClient(clientId);
    }, 1000);
  }, [cleanupParticipant, connectToStreamingClient]);

  // Minden connection tisztítása
  const cleanupAllConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc, participantId) => {
      if ((pc as any).statsInterval) {
        clearInterval((pc as any).statsInterval);
      }
      pc.close();
    });
    
    peerConnectionsRef.current.clear();
    videoRefsRef.current.clear();
    streamRefsRef.current.clear();
    pendingCandidatesRef.current.clear();
    
    fullscreenWindowsRef.current.forEach(window => {
      if (window && !window.closed) {
        window.close();
      }
    });
    fullscreenWindowsRef.current.clear();
  }, []);

  // Link másolása
  const copyShareLink = useCallback(() => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setSuccess('Link vágólapra másolva!');
      setTimeout(() => setSuccess(null), 3000);
    }).catch(() => {
      setError('Nem sikerült másolni a linket');
    });
  }, [shareLink]);

  // Felhasználó kirúgása
  const kickUser = useCallback((participantId: string) => {
    if (socketRef.current) {
      socketRef.current.emit('kick-user', roomId, participantId);
    }
  }, [roomId]);

  // Fullscreen mód váltása
  const toggleFullscreen = useCallback((participantId: string) => {
    const existingWindow = fullscreenWindowsRef.current.get(participantId);
    
    if (existingWindow && !existingWindow.closed) {
      existingWindow.close();
      fullscreenWindowsRef.current.delete(participantId);
      return;
    }

    const stream = streamRefsRef.current.get(participantId);
    if (!stream) return;

    const newWindow = window.open('', '_blank', 'width=1920,height=1080,fullscreen=yes');
    if (!newWindow) return;

    fullscreenWindowsRef.current.set(participantId, newWindow);

    // Transform beállítások alkalmazása
    const settings = participantSettings.get(participantId);
    let videoTransform = '';
    if (settings) {
      if (settings.flipHorizontal) videoTransform += 'scaleX(-1) ';
      if (settings.flipVertical) videoTransform += 'scaleY(-1) ';
      if (settings.rotation !== 0) videoTransform += `rotate(${settings.rotation}deg) `;
    }

    // Fullscreen ablak tartalma
    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Camera View - ${participantId.slice(0, 8)}</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              background: black;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              overflow: hidden;
            }
            video {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              ${videoTransform ? `transform: ${videoTransform.trim()};` : ''}
            }
            .controls {
              position: fixed;
              top: 20px;
              right: 20px;
              background: rgba(0,0,0,0.8);
              padding: 10px;
              border-radius: 8px;
              color: white;
              font-family: Arial, sans-serif;
            }
            .controls button {
              background: #ff4444;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              margin-left: 10px;
            }
            .info {
              position: fixed;
              bottom: 20px;
              left: 20px;
              background: rgba(0,0,0,0.8);
              padding: 10px;
              border-radius: 8px;
              color: white;
              font-family: Arial, sans-serif;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <video id="video" autoplay playsinline></video>
          <div class="controls">
            <span>User: ${participantId.slice(0, 8)}</span>
            <button onclick="window.close()">Close</button>
          </div>
          <div class="info" id="info">
            Loading...
          </div>
        </body>
      </html>
    `);
    
    newWindow.document.close();

    // Video stream hozzáadása - kis késleltetéssel hogy a DOM elem létrejöjjön
    setTimeout(() => {
      const video = newWindow.document.getElementById('video') as HTMLVideoElement;
      if (video && stream && !newWindow.closed) {
        console.log('Setting stream for fullscreen video:', participantId);
        video.srcObject = stream;
        video.play().catch(err => {
          console.error('Error playing fullscreen video:', err);
        });
      } else {
        console.error('Fullscreen video element or stream not found:', {
          video: !!video,
          stream: !!stream,
          closed: newWindow.closed
        });
      }
    }, 500);

    // Statisztikák megjelenítése
    const updateInfo = () => {
      const info = newWindow.document.getElementById('info');
      const stats = streamStats.get(participantId);
      if (info && stats && !newWindow.closed) {
        info.innerHTML = `
          FPS: ${stats.fps.toFixed(1)}<br>
          Bitrate: ${stats.bitrate.toFixed(0)} kbps<br>
          Dropped Frames: ${stats.droppedFrames}<br>
          Packet Loss: ${stats.packetLoss.toFixed(1)}%
        `;
      }
    };

    const infoInterval = setInterval(() => {
      if (newWindow.closed) {
        clearInterval(infoInterval);
        fullscreenWindowsRef.current.delete(participantId);
    } else {
        updateInfo();
      }
    }, 1000);

          newWindow.onunload = () => {
      clearInterval(infoInterval);
      fullscreenWindowsRef.current.delete(participantId);
    };
  }, [streamStats]);

  // Audio source váltása
  const changeAudioSource = useCallback((participantId: string) => {
    console.log('Changing audio source from', selectedAudioSource, 'to', participantId);
    
    // Korábbi audio source lekapcsolása
    if (selectedAudioSource) {
      const oldSource = audioSourcesRef.current.get(selectedAudioSource);
      if (oldSource) {
        try {
          oldSource.disconnect();
          console.log('Disconnected old audio source:', selectedAudioSource);
        } catch (err) {
          console.error('Error disconnecting old audio source:', err);
        }
      }
    }

    // Új audio source csatlakoztatása
    if (participantId && audioContextRef.current) {
      const newSource = audioSourcesRef.current.get(participantId);
      console.log('New audio source found:', !!newSource);
      
      if (newSource) {
        try {
          newSource.connect(audioContextRef.current.destination);
          setSelectedAudioSource(participantId);
          setSuccess(`Audio switched to ${participantId.slice(0, 8)}`);
          console.log('Connected new audio source:', participantId);
        } catch (err) {
          console.error('Error connecting new audio source:', err);
          setError('Hiba az audio source csatlakoztatásakor');
        }
      } else {
        setError('Audio source nem található');
      }
    } else {
      setSelectedAudioSource('');
      console.log('Audio source cleared');
    }
  }, [selectedAudioSource]);

  // Egyedi kamera nézet megnyitása (OBS-hez)
  const openSingleCameraView = useCallback((participantId: string) => {
    const baseUrl = window.location.origin;
    const settings = participantSettings.get(participantId);
    const password = searchParams.get('password') || '';
    
    const params = new URLSearchParams();
    params.set('roomId', roomId);
    if (password) params.set('password', password);
    
    if (settings) {
      if (settings.flipHorizontal) params.set('flipH', '1');
      if (settings.flipVertical) params.set('flipV', '1');
      if (settings.rotation !== 0) params.set('rotation', settings.rotation.toString());
    }
    
    const url = `${baseUrl}/camera/${participantId}?${params.toString()}`;
    window.open(url, '_blank');
  }, [roomId, participantSettings, searchParams]);

  // Participant beállítások kezelése
  const updateParticipantSetting = useCallback((participantId: string, key: 'flipHorizontal' | 'flipVertical' | 'rotation', value: boolean | number) => {
    setParticipantSettings(prev => {
      const newMap = new Map(prev);
      const currentSettings = newMap.get(participantId) || { flipHorizontal: false, flipVertical: false, rotation: 0 };
      newMap.set(participantId, { ...currentSettings, [key]: value });
      return newMap;
    });
  }, []);

  // Transform style generálása
  const getVideoTransform = useCallback((participantId: string) => {
    const settings = participantSettings.get(participantId);
    if (!settings) return {};

    let transform = '';
    if (settings.flipHorizontal) transform += 'scaleX(-1) ';
    if (settings.flipVertical) transform += 'scaleY(-1) ';
    if (settings.rotation !== 0) transform += `rotate(${settings.rotation}deg) `;

    return transform ? { transform: transform.trim() } : {};
  }, [participantSettings]);

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="container mx-auto max-w-7xl">
        
        {/* Header */}
        <div className="card bg-base-100 shadow-xl mb-6">
          <div className="card-body">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-primary mb-2">{roomName}</h1>
                <p className="text-base-content/70">Admin Panel - Szoba ID: {roomId}</p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="join">
                  <input
                    type="text"
                    value={shareLink}
                    readOnly
                    className="input input-bordered join-item flex-1 min-w-0"
                  />
                  <button onClick={copyShareLink} className="btn btn-primary join-item">
                    Másolás
                  </button>
                </div>
              </div>
            </div>
            
            {/* Audio controls */}
            <div className="flex items-center gap-4 mt-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Audio forrás:</span>
                </label>
                <select
                  value={selectedAudioSource}
                  onChange={(e) => {
                    console.log('Audio source changed to:', e.target.value);
                    changeAudioSource(e.target.value);
                  }}
                  className="select select-bordered select-sm"
                >
                  <option value="">Nincs hang</option>
                  {participants
                    .filter(p => p.hasAudio)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        User {p.id.slice(0, 8)} {p.isAdmin ? '(Admin)' : ''}
                      </option>
                    ))
                  }
                </select>
              </div>
              
              <div className="form-control">
                <label className="cursor-pointer label">
                  <span className="label-text mr-2">Hang engedélyezése</span>
                  <input
                    type="checkbox"
                    checked={audioEnabled}
                    onChange={(e) => setAudioEnabled(e.target.checked)}
                    className="checkbox checkbox-primary"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Hibaüzenetek */}
        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="alert alert-success mb-4">
            <span>{success}</span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center mb-4">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        )}

        {/* Participants Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
          {participants.map(participant => (
            <div key={participant.id} className="card bg-base-100 shadow-xl">
              <div className="card-body p-4">
                
                {/* Participant header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-sm">
                      {participant.id.slice(0, 8)}
                      {participant.isAdmin && <span className="badge badge-primary badge-sm ml-1">Admin</span>}
                    </h3>
                    <div className="flex gap-1 mt-1">
                      {participant.hasVideo && <span className="badge badge-success badge-xs">Video</span>}
                      {participant.hasAudio && <span className="badge badge-info badge-xs">Audio</span>}
        </div>
      </div>
                  
                  {/* Actions dropdown */}
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-ghost btn-xs">⋮</label>
                    <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-50">
                      <li>
                        <button onClick={() => toggleFullscreen(participant.id)}>
                        Fullscreen
                      </button>
                      </li>
                      <li>
                        <button onClick={() => openSingleCameraView(participant.id)}>
                          Egyedi nézet (OBS)
                        </button>
                      </li>
                      <li>
                        <button onClick={() => restartConnection(participant.id)}>
                          🔄 Kapcsolat újraindítása
                        </button>
                      </li>
                      <li>
                        <button 
                          onClick={() => changeAudioSource(participant.id)}
                          disabled={!participant.hasAudio}
                        >
                          Audio kiválasztása
                        </button>
                      </li>
                      <li><div className="divider my-1"></div></li>
                      <li>
                        <button onClick={() => updateParticipantSetting(participant.id, 'flipHorizontal', !participantSettings.get(participant.id)?.flipHorizontal)}>
                          🔄 Vízszintes tükrözés
                          {participantSettings.get(participant.id)?.flipHorizontal && ' ✓'}
                        </button>
                      </li>
                      <li>
                        <button onClick={() => updateParticipantSetting(participant.id, 'flipVertical', !participantSettings.get(participant.id)?.flipVertical)}>
                          ↕️ Függőleges tükrözés
                          {participantSettings.get(participant.id)?.flipVertical && ' ✓'}
                        </button>
                      </li>
                      <li>
                        <button onClick={() => {
                          const current = participantSettings.get(participant.id)?.rotation || 0;
                          updateParticipantSetting(participant.id, 'rotation', (current + 90) % 360);
                        }}>
                          🔄 Forgatás (90°)
                        </button>
                      </li>
                      <li><div className="divider my-1"></div></li>
                      <li>
                      <button
                          onClick={() => setShowKickConfirm(participant.id)}
                          className="text-error"
                      >
                          Kirúgás
                      </button>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Video */}
                <div className="relative bg-black rounded-lg overflow-hidden mb-3" style={{ aspectRatio: '16/9' }}>
                  <video
                    ref={(el) => {
                      videoRefsRef.current.set(participant.id, el);
                    }}
                    autoPlay
                    playsInline
                    muted={!audioEnabled || selectedAudioSource !== participant.id}
                    className="w-full h-full object-contain"
                    style={getVideoTransform(participant.id)}
                  />
                  
                  {!participant.hasVideo && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center text-white/70">
                        <div className="text-2xl mb-1">📷</div>
                        <p className="text-xs">Nincs videó</p>
                      </div>
                    </div>
                  )}
                  
                  {selectedAudioSource === participant.id && audioEnabled && (
                    <div className="absolute top-2 left-2">
                      <span className="badge badge-info badge-sm">🔊 Aktív hang</span>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="stat-item">
                    <span className="text-base-content/60">FPS:</span>
                    <span className="font-mono ml-1">
                      {streamStats.get(participant.id)?.fps?.toFixed(1) || '0.0'}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="text-base-content/60">Bitrate:</span>
                    <span className="font-mono ml-1">
                      {streamStats.get(participant.id)?.bitrate?.toFixed(0) || '0'} kbps
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="text-base-content/60">Dropped:</span>
                    <span className="font-mono ml-1">
                      {streamStats.get(participant.id)?.droppedFrames || 0}
                    </span>
                    </div>
                  <div className="stat-item">
                    <span className="text-base-content/60">Loss:</span>
                    <span className="font-mono ml-1">
                      {streamStats.get(participant.id)?.packetLoss?.toFixed(1) || '0.0'}%
                    </span>
                  </div>
                </div>

                {/* Stream settings */}
                <div className="text-xs text-base-content/60 mt-2">
                  {participant.streamSettings.resolution} • {participant.streamSettings.fps}fps • {participant.streamSettings.bitrate}kbps
                </div>

                {/* Kick confirmation */}
                {showKickConfirm === participant.id && (
                  <div className="mt-3 p-2 bg-error/10 rounded border border-error/20">
                    <p className="text-xs mb-2">Biztosan kirúgod ezt a felhasználót?</p>
                      <div className="flex gap-2">
                        <button
                        onClick={() => kickUser(participant.id)}
                        className="btn btn-error btn-xs flex-1"
                        >
                        Igen
                        </button>
                        <button
                          onClick={() => setShowKickConfirm(null)}
                        className="btn btn-ghost btn-xs flex-1"
                        >
                        Mégse
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>

        {/* Empty state */}
        {participants.length === 0 && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body text-center py-12">
              <div className="text-6xl mb-4">👥</div>
              <h3 className="text-xl font-bold mb-2">Nincsenek résztvevők</h3>
              <p className="text-base-content/70 mb-4">
                Oszd meg a linket, hogy mások is csatlakozhasson a szobához
              </p>
              <button onClick={copyShareLink} className="btn btn-primary">
                Link másolása
              </button>
            </div>
          </div>
        )}

        {/* Participants sidebar */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h3 className="card-title text-lg mb-4">
              Résztvevők ({participants.length})
            </h3>
            
            {participants.length > 0 ? (
              <div className="space-y-2">
                {participants.map(participant => (
                  <div key={participant.id} className="flex items-center justify-between p-2 rounded bg-base-200">
                    <div className="flex items-center gap-2">
                      <div className="avatar placeholder">
                        <div className="bg-neutral text-neutral-content rounded-full w-8">
                          <span className="text-xs">{participant.id.slice(0, 2).toUpperCase()}</span>
                        </div>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{participant.id.slice(0, 8)}</p>
                        <div className="flex gap-1">
                          {participant.hasVideo && <span className="badge badge-success badge-xs">V</span>}
                          {participant.hasAudio && <span className="badge badge-info badge-xs">A</span>}
                          {participant.isAdmin && <span className="badge badge-primary badge-xs">Admin</span>}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-1">
                      <button 
                        onClick={() => toggleFullscreen(participant.id)}
                        className="btn btn-ghost btn-xs"
                        title="Fullscreen"
                      >
                        ⛶
                      </button>
                      <button 
                        onClick={() => openSingleCameraView(participant.id)}
                        className="btn btn-ghost btn-xs"
                        title="Egyedi nézet"
                      >
                        🎥
                      </button>
                      <button 
                        onClick={() => setShowKickConfirm(participant.id)}
                        className="btn btn-ghost btn-xs text-error"
                        title="Kirúgás"
                      >
                        ✕
                      </button>
          </div>
        </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-base-content/60">Nincsenek résztvevők</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminRoom;