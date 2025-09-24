'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  IconVideo, 
  IconUsers, 
  IconSettings, 
  IconBroadcast, 
  IconCamera, 
  IconMicrophone,
  IconArrowRight,
  IconLogin,
  IconPlus,
  IconShield,
  IconEye,
  IconRefresh
} from '@tabler/icons-react';
import ThemeSwitcher from '@/components/ThemeSwitcher';

const HomePage: React.FC = () => {
  const router = useRouter();
  
  // States
  const [roomName, setRoomName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Szoba létrehozása
  const createRoom = useCallback(async () => {
    if (!roomName.trim()) {
      setError('Szoba neve kötelező');
      return;
    }

    if (!password.trim()) {
      setError('Jelszó megadása kötelező');
      return;
    }

    if (password.length < 4) {
      setError('Jelszónak legalább 4 karakter hosszúnak kell lennie');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Random room ID generálása
      const roomId = Math.random().toString(36).substring(2, 10);
      
      // Átirányítás az admin oldalra azonnal, a socket kapcsolat ott fog létrejönni
      const adminUrl = `/admin/${roomId}?name=${encodeURIComponent(roomName.trim())}&password=${encodeURIComponent(password.trim())}`;
      
      setSuccess('Szoba létrehozva! Átirányítás...');
      
      // Használjuk a Next.js router.replace-t ami nem újratölti az oldalt
      setTimeout(() => {
        router.replace(adminUrl);
      }, 500);

    } catch (err) {
      console.error('Error creating room:', err);
      setError('Váratlan hiba történt');
      setIsLoading(false);
    }
  }, [roomName, password, router]);

  // Szoba ID alapján csatlakozás
  const [joinRoomId, setJoinRoomId] = useState<string>('');
  
  const joinRoom = useCallback(() => {
    if (!joinRoomId.trim()) {
      setError('Szoba ID megadása kötelező');
      return;
    }

    const cleanRoomId = joinRoomId.trim();
    router.push(`/join/${cleanRoomId}`);
  }, [joinRoomId, router]);

  return (
    <div className="min-h-screen bg-base-100">
      {/* Navigation */}
      <div className="navbar bg-base-200 shadow-sm">
        <div className="navbar-start">
          <div className="flex items-center gap-2">
            <IconVideo className="w-8 h-8 text-primary" />
            <span className="text-xl font-bold">tStream</span>
          </div>
        </div>
        <div className="navbar-end">
          <ThemeSwitcher />
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-full bg-primary/10">
              <IconBroadcast className="w-16 h-16 text-primary" />
            </div>
          </div>
          <h1 className="text-5xl font-bold mb-6">
            Wireless Camera 
            <span className="text-primary"> Streaming</span>
          </h1>
          <p className="text-xl text-base-content/70 max-w-3xl mx-auto leading-relaxed">
            Professional wireless camera streaming platform with OBS integration. 
            Stream from any device to a central control dashboard with real-time management.
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="alert alert-error mb-6 max-w-2xl mx-auto">
            <IconRefresh className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="alert alert-success mb-6 max-w-2xl mx-auto">
            <IconEye className="w-5 h-5" />
            <span>{success}</span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center mb-6">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          
          {/* Create Room */}
          <div className="card bg-base-100 shadow-xl border border-base-300">
            <div className="card-body">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-primary/10">
                  <IconPlus className="w-6 h-6 text-primary" />
                </div>
                <h2 className="card-title text-2xl">
                  Create New Room
                </h2>
              </div>
              
              <div className="space-y-6">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Room Name</span>
                  </label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    className="input input-bordered input-lg"
                    placeholder="e.g. Studio Cameras, Event Stream..."
                    disabled={isLoading}
                    maxLength={50}
                  />
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      {roomName.length}/50 characters
                    </span>
                  </label>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Password</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input input-bordered input-lg"
                    placeholder="Minimum 4 characters"
                    disabled={isLoading}
                    maxLength={20}
                  />
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      Required for participants to join
                    </span>
                  </label>
                </div>
              </div>

              <div className="card-actions justify-center mt-8">
                <button
                  onClick={createRoom}
                  disabled={isLoading || !roomName.trim() || !password.trim()}
                  className="btn btn-primary btn-lg btn-wide"
                >
                  {isLoading ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Creating...
                    </>
                  ) : (
                    <>
                      Create Room
                      <IconArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>

              <div className="mt-6 p-4 bg-info/10 rounded-lg border border-info/20">
                <div className="flex items-center gap-2 mb-3">
                  <IconSettings className="w-5 h-5 text-info" />
                  <h3 className="font-bold text-info">Admin Features:</h3>
                </div>
                <ul className="text-sm space-y-1 text-base-content/80">
                  <li>• Participant management and kick functionality</li>
                  <li>• Fullscreen view and individual camera views</li>
                  <li>• Audio source selection</li>
                  <li>• Real-time stream statistics</li>
                  <li>• OBS Browser Source integration</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Join Room */}
          <div className="card bg-base-100 shadow-xl border border-base-300">
            <div className="card-body">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-secondary/10">
                  <IconLogin className="w-6 h-6 text-secondary" />
                </div>
                <h2 className="card-title text-2xl">
                  Join Existing Room
                </h2>
              </div>
              
              <div className="space-y-6">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Room ID</span>
                  </label>
                  <input
                    type="text"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value.toLowerCase())}
                    className="input input-bordered input-lg"
                    placeholder="e.g. abc123xy"
                    disabled={isLoading}
                    maxLength={20}
                  />
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      Enter the unique room identifier
                    </span>
                  </label>
                </div>
              </div>

              <div className="card-actions justify-center mt-8">
                <button
                  onClick={joinRoom}
                  disabled={isLoading || !joinRoomId.trim()}
                  className="btn btn-secondary btn-lg btn-wide"
                >
                  Join Room
                  <IconLogin className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-6 p-4 bg-success/10 rounded-lg border border-success/20">
                <div className="flex items-center gap-2 mb-3">
                  <IconCamera className="w-5 h-5 text-success" />
                  <h3 className="font-bold text-success">Streaming Features:</h3>
                </div>
                <ul className="text-sm space-y-1 text-base-content/80">
                  <li>• Camera and microphone selection</li>
                  <li>• Resolution, FPS and bitrate settings</li>
                  <li>• Image rotation and flipping</li>
                  <li>• Real-time stream configuration</li>
                  <li>• Stable WebRTC connection</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div className="mt-20">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">
              Key Features
            </h2>
            <p className="text-lg text-base-content/70 max-w-2xl mx-auto">
              Everything you need for professional wireless camera streaming
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            
            <div className="card bg-base-100 shadow-xl border border-base-300 hover:shadow-2xl transition-shadow">
              <div className="card-body text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-full bg-primary/10">
                    <IconVideo className="w-8 h-8 text-primary" />
                  </div>
                </div>
                <h3 className="card-title justify-center mb-3">
                  Multi-Camera Streaming
                </h3>
                <p className="text-base-content/70">
                  Stream from multiple devices simultaneously to a central location. 
                  Perfect for events and studio work.
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl border border-base-300 hover:shadow-2xl transition-shadow">
              <div className="card-body text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-full bg-secondary/10">
                    <IconSettings className="w-8 h-8 text-secondary" />
                  </div>
                </div>
                <h3 className="card-title justify-center mb-3">
                  Full Control
                </h3>
                <p className="text-base-content/70">
                  Real-time resolution, FPS, and bitrate settings. 
                  Image rotation, flipping, and optimization.
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl border border-base-300 hover:shadow-2xl transition-shadow">
              <div className="card-body text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-full bg-accent/10">
                    <IconBroadcast className="w-8 h-8 text-accent" />
                  </div>
                </div>
                <h3 className="card-title justify-center mb-3">
                  OBS Integration
                </h3>
                <p className="text-base-content/70">
                  Individual camera views as Browser Sources. 
                  Easy integration with OBS or other streaming software.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Details */}
        <div className="mt-20">
          <div className="card bg-base-100 shadow-xl border border-base-300 max-w-5xl mx-auto">
            <div className="card-body">
              <div className="text-center mb-8">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-full bg-info/10">
                    <IconSettings className="w-8 h-8 text-info" />
                  </div>
                </div>
                <h2 className="text-3xl font-bold mb-2">
                  Technical Specifications
                </h2>
                <p className="text-base-content/70">
                  Professional streaming capabilities and browser compatibility
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <h3 className="font-bold mb-3 text-primary">Supported Resolutions</h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        480p (854×480)
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        720p (1280×720) - Recommended
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        1080p (1920×1080)
                      </li>
                    </ul>
                  </div>
                  
                  <div className="p-4 bg-secondary/5 rounded-lg border border-secondary/20">
                    <h3 className="font-bold mb-3 text-secondary">Stream Settings</h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        FPS: 15-60 range
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        Bitrate: 500-8000 kbps
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        WebRTC P2P connection
                      </li>
                    </ul>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-accent/5 rounded-lg border border-accent/20">
                    <h3 className="font-bold mb-3 text-accent">Browser Support</h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-accent rounded-full"></div>
                        Chrome/Edge (Recommended)
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-accent rounded-full"></div>
                        Firefox
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-accent rounded-full"></div>
                        Safari (iOS/macOS)
                      </li>
                    </ul>
                  </div>
                  
                  <div className="p-4 bg-info/5 rounded-lg border border-info/20">
                    <h3 className="font-bold mb-3 text-info">OBS Browser Source</h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-info rounded-full"></div>
                        Unique URL for each camera
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-info rounded-full"></div>
                        Fullscreen support
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-info rounded-full"></div>
                        Automatic reconnection
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="footer footer-center p-10 bg-base-200 text-base-content mt-20">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <IconVideo className="w-6 h-6 text-primary" />
              <span className="text-lg font-bold">tStream</span>
            </div>
            <p className="text-base-content/70">
              © 2024 tStream - Wireless Camera Streaming Platform
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default HomePage;