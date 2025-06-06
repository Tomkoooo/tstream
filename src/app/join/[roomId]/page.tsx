'use client';

import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import { useParams } from 'next/navigation';

const JoinRoom: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socket = useRef<Socket | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const params = useParams();
  const roomId = params.roomId as string;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCameraStarted, setIsCameraStarted] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(30);
  const [bitrate, setBitrate] = useState<number>(2000);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [rotation, setRotation] = useState<number>(0);
  const [flip, setFlip] = useState<'none' | 'horizontal' | 'vertical'>('none');

  useEffect(() => {
    socket.current = io({ path: '/api/socket', transports: ['websocket'] });

    socket.current.on('kicked', (kickedRoomId: string) => {
      if (kickedRoomId === roomId) {
        setError('You have been kicked from the room');
        leaveRoom();
      }
    });

    const getCameras = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((device) => device.kind === 'videoinput');
        
        const sortedDevices = videoInputs.sort((a, b) => {
          const aLabel = a.label.toLowerCase();
          const bLabel = b.label.toLowerCase();
          
          if (aLabel.includes('front') && !bLabel.includes('front')) return -1;
          if (!aLabel.includes('front') && bLabel.includes('front')) return 1;
          
          if (aLabel.includes('back') && !bLabel.includes('back')) return -1;
          if (!aLabel.includes('back') && bLabel.includes('back')) return 1;
          
          return aLabel.localeCompare(bLabel);
        });
        
        setVideoDevices(sortedDevices);
        if (sortedDevices.length > 0) {
          setDeviceId(sortedDevices[0].deviceId);
        }
      } catch (err) {
        setError('Nem sikerült hozzáférni a kamerákhoz. Kérjük, ellenőrizze a kamera engedélyeket.');
      }
    };

    getCameras();

    return () => {
      socket.current?.disconnect();
      peerConnection.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [roomId]);

  const getCameraLabel = (device: MediaDeviceInfo) => {
    const label = device.label.toLowerCase();
    if (label.includes('front')) return 'Front camera';
    if (label.includes('back')) return 'Back camera';
    if (label.includes('external')) return 'External camera';
    return device.label || `Camera ${device.deviceId.slice(0, 8)}`;
  };

  const updateStream = async () => {
    setIsLoading(true);
    setError(null);

    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const constraints: MediaStreamConstraints = {
        video: {
          frameRate: { ideal: fps },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          deviceId: deviceId ? { exact: deviceId } : undefined,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      if (peerConnection.current) {
        const sender = peerConnection.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && stream.getVideoTracks()[0]) {
          sender.replaceTrack(stream.getVideoTracks()[0]);
          const parameters = sender.getParameters();
          if (!parameters.encodings) parameters.encodings = [{}];
          parameters.encodings[0].maxBitrate = bitrate * 1000;
          sender.setParameters(parameters);
        }
      }
      setSuccess('Kamera beállítások sikeresen frissítve!');
    } catch (err) {
      setError('Nem sikerült frissíteni a kamera beállításokat');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = () => {
    if (!password) {
      setError('Password is required');
      return;
    }
    setIsLoading(true);
    setError(null);
    socket.current?.emit('join-room', roomId, password, (success: boolean, errorMsg?: string) => {
      setIsLoading(false);
      if (!success) {
        setError(errorMsg || 'Failed to join room');
        return;
      }
      setSuccess('Successfully joined the room!');
      setIsJoined(true);
    });
  };

  const startCamera = async () => {
    setIsLoading(true);
    setError(null);

    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      
      const constraints: MediaStreamConstraints = {
        video: {
          frameRate: { ideal: fps },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          deviceId: deviceId ? { exact: deviceId } : undefined,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(err => {
          console.error('Video play error:', err);
          setError('Nem sikerült elindítani a videót');
        });
      }

      if (peerConnection.current) {
        peerConnection.current.close();
      }

      peerConnection.current = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      peerConnection.current.oniceconnectionstatechange = () => {
        console.log('ICE kapcsolat állapot:', peerConnection.current?.iceConnectionState);
        if (peerConnection.current?.iceConnectionState === 'failed' || 
            peerConnection.current?.iceConnectionState === 'disconnected') {
          console.log('Kapcsolat megszakadt, újrakapcsolódás...');
          refreshVideo();
        }
      };

      stream.getTracks().forEach((track) => {
        peerConnection.current?.addTrack(track, stream);
      });

      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate && socket.current) {
          socket.current.emit('ice-candidate', event.candidate, roomId, socket.current.id);
        }
      };

      socket.current?.on('offer', async (offer: RTCSessionDescriptionInit, fromSocketId: string) => {
        if (!peerConnection.current) return;
        try {
          console.log('Processing offer from:', fromSocketId);
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          console.log('Sending answer to:', fromSocketId);
          socket.current?.emit('answer', answer, roomId, socket.current.id);
        } catch (err) {
          console.error('Error processing offer:', err);
          setError('Nem sikerült feldolgozni a WebRTC ajánlatot');
          refreshVideo();
        }
      });

      socket.current?.on('answer', async (answer: RTCSessionDescriptionInit, fromSocketId: string) => {
        if (!peerConnection.current) return;
        try {
          console.log('Processing answer from:', fromSocketId);
          if (peerConnection.current.signalingState !== 'stable') {
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Answer processed successfully');
          } else {
            console.log('Ignoring answer in stable state');
          }
        } catch (err) {
          console.error('Error processing answer:', err);
          setError('Nem sikerült feldolgozni a WebRTC választ');
          refreshVideo();
        }
      });

      socket.current?.on('ice-candidate', async (candidate: RTCIceCandidateInit, fromSocketId: string) => {
        if (!peerConnection.current) return;
        try {
          console.log('Adding ICE candidate from:', fromSocketId);
          if (peerConnection.current.remoteDescription) {
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate added successfully');
          } else {
            console.log('Ignoring ICE candidate - no remote description');
          }
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      });

      if (peerConnection.current && socket.current) {
        try {
          console.log('Creating initial offer');
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          console.log('Sending initial offer');
          socket.current.emit('offer', offer, roomId, socket.current.id);
        } catch (err) {
          console.error('Error creating initial offer:', err);
          setError('Nem sikerült létrehozni a WebRTC ajánlatot');
          refreshVideo();
        }
      }

      setIsCameraStarted(true);
      setSuccess('Kamera sikeresen elindítva!');
    } catch (err) {
      setError('Nem sikerült hozzáférni a kamerához');
      console.error('Kamera hiba:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const leaveRoom = () => {
    setIsLoading(true);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    
    socket.current?.disconnect();
    socket.current = io({ path: '/api/socket', transports: ['websocket'] });
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsCameraStarted(false);
    setIsJoined(false);
    setPassword('');
    setSuccess('Successfully left the room');
    setIsLoading(false);
  };

  const refreshVideo = async () => {
    if (!isCameraStarted) return;
    
    setIsLoading(true);
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      
      const constraints: MediaStreamConstraints = {
        video: {
          frameRate: { ideal: fps },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          deviceId: deviceId ? { exact: deviceId } : undefined,
        },
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.load();
      }
      
      setSuccess('Video refreshed successfully');
    } catch (err) {
      setError('Failed to refresh video');
      console.error('Video refresh error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-4">Join Room: {roomId}</h1>
      {error && <div className="alert alert-error mb-4"><span>{error}</span></div>}
      {success && <div className="alert alert-success mb-4"><span>{success}</span></div>}
      {isLoading && <span className="loading loading-spinner loading-lg mb-4"></span>}
      {!isJoined ? (
        <div className="form-control w-full max-w-xs">
          <label className="label"><span className="label-text">Password</span></label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input input-bordered w-full"
            placeholder="Enter room password"
            disabled={isLoading}
          />
          <button className="btn btn-primary mt-4" onClick={handleJoinRoom} disabled={isLoading}>
            Join Room
          </button>
        </div>
      ) : (
        <div className="w-full max-w-xs">
          {!isCameraStarted ? (
            <>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">FPS</span></label>
                <input
                  type="range"
                  min={15}
                  max={60}
                  value={fps}
                  className="range range-primary"
                  onChange={(e) => setFps(Number(e.target.value))}
                />
                <div className="text-center">{fps} FPS</div>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Bitrate (kbps)</span></label>
                <input
                  type="range"
                  min={500}
                  max={5000}
                  value={bitrate}
                  className="range range-primary"
                  onChange={(e) => setBitrate(Number(e.target.value))}
                />
                <div className="text-center">{bitrate} kbps</div>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Kamera</span></label>
                <select
                  className="select select-bordered w-full"
                  value={deviceId}
                  onChange={(e) => {
                    setDeviceId(e.target.value);
                    updateStream();
                  }}
                >
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {getCameraLabel(device)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Rotation</span></label>
                <select
                  className="select select-bordered w-full"
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                >
                  <option value={0}>0°</option>
                  <option value={90}>90°</option>
                  <option value={180}>180°</option>
                  <option value={270}>270°</option>
                </select>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Flip</span></label>
                <select
                  className="select select-bordered w-full"
                  value={flip}
                  onChange={(e) => setFlip(e.target.value as 'none' | 'horizontal' | 'vertical')}
                >
                  <option value="none">None</option>
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </select>
              </div>
              <button className="btn btn-primary w-full" onClick={startCamera} disabled={isLoading}>
                Start Camera
              </button>
            </>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full rounded-lg mb-4"
                style={{
                  transform: `rotate(${rotation}deg) ${flip === 'horizontal' ? 'scaleX(-1)' : ''} ${flip === 'vertical' ? 'scaleY(-1)' : ''}`,
                }}
              />
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">FPS</span></label>
                <input
                  type="range"
                  min={15}
                  max={60}
                  value={fps}
                  className="range range-primary"
                  onChange={(e) => setFps(Number(e.target.value))}
                />
                <div className="text-center">{fps} FPS</div>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Bitrate (kbps)</span></label>
                <input
                  type="range"
                  min={500}
                  max={5000}
                  value={bitrate}
                  className="range range-primary"
                  onChange={(e) => setBitrate(Number(e.target.value))}
                />
                <div className="text-center">{bitrate} kbps</div>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Kamera</span></label>
                <select
                  className="select select-bordered w-full"
                  value={deviceId}
                  onChange={(e) => {
                    setDeviceId(e.target.value);
                    updateStream();
                  }}
                >
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {getCameraLabel(device)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Rotation</span></label>
                <select
                  className="select select-bordered w-full"
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                >
                  <option value={0}>0°</option>
                  <option value={90}>90°</option>
                  <option value={180}>180°</option>
                  <option value={270}>270°</option>
                </select>
              </div>
              <div className="form-control mb-4">
                <label className="label"><span className="label-text">Flip</span></label>
                <select
                  className="select select-bordered w-full"
                  value={flip}
                  onChange={(e) => setFlip(e.target.value as 'none' | 'horizontal' | 'vertical')}
                >
                  <option value="none">None</option>
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </select>
              </div>
              <button className="btn btn-primary w-full mb-2" onClick={updateStream} disabled={isLoading}>
                Update Settings
              </button>
              <button className="btn btn-secondary w-full mb-2" onClick={refreshVideo} disabled={isLoading}>
                Refresh Video
              </button>
              <button className="btn btn-error w-full" onClick={leaveRoom} disabled={isLoading}>
                Leave Call
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default JoinRoom;