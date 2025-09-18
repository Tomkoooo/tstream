'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import io from 'socket.io-client';

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
    <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10">
      <div className="container mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-primary mb-4">
            🎥 TStream
          </h1>
          <p className="text-xl text-base-content/70 max-w-2xl mx-auto">
            Vezeték nélküli kamera streaming platform OBS integrációval. 
            Könnyen streamelj bármilyen eszközről központi helyre.
          </p>
        </div>

        {/* Hibaüzenetek */}
        {error && (
          <div className="alert alert-error mb-6 max-w-2xl mx-auto">
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="alert alert-success mb-6 max-w-2xl mx-auto">
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
          
          {/* Szoba létrehozása */}
          <div className="card bg-base-100 shadow-2xl">
            <div className="card-body">
              <h2 className="card-title text-2xl mb-6 justify-center">
                🎬 Új szoba létrehozása
              </h2>
              
              <div className="space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Szoba neve</span>
                  </label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    className="input input-bordered input-lg"
                    placeholder="pl. Stúdió kamerák, Esemény stream..."
                    disabled={isLoading}
                    maxLength={50}
                  />
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      {roomName.length}/50 karakter
                    </span>
                  </label>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Jelszó</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input input-bordered input-lg"
                    placeholder="Minimum 4 karakter"
                    disabled={isLoading}
                    maxLength={20}
                  />
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      Ez lesz szükséges a csatlakozáshoz
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
                      Létrehozás...
                    </>
                  ) : (
                    <>
                      Szoba létrehozása
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>

              <div className="mt-6 p-4 bg-info/10 rounded-lg">
                <h3 className="font-bold text-info mb-2">💡 Admin funkciók:</h3>
                <ul className="text-sm space-y-1 text-base-content/80">
                  <li>• Résztvevők kezelése és kirúgása</li>
                  <li>• Fullscreen nézet és egyedi kamera nézetek</li>
                  <li>• Hang forrás kiválasztása</li>
                  <li>• Stream statisztikák valós időben</li>
                  <li>• OBS Browser Source integráció</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Csatlakozás meglévő szobához */}
          <div className="card bg-base-100 shadow-2xl">
            <div className="card-body">
              <h2 className="card-title text-2xl mb-6 justify-center">
                📱 Csatlakozás szobához
              </h2>
              
              <div className="space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Szoba ID</span>
                  </label>
                  <input
                    type="text"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value.toLowerCase())}
                    className="input input-bordered input-lg"
                    placeholder="pl. abc123xy"
                    disabled={isLoading}
                    maxLength={20}
                  />
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      Add meg a szoba egyedi azonosítóját
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
                  Csatlakozás
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>

              <div className="mt-6 p-4 bg-success/10 rounded-lg">
                <h3 className="font-bold text-success mb-2">📹 Streaming funkciók:</h3>
                <ul className="text-sm space-y-1 text-base-content/80">
                  <li>• Kamera és mikrofon kiválasztása</li>
                  <li>• Felbontás, FPS és bitráta beállítások</li>
                  <li>• Kép forgatása és tükrözése</li>
                  <li>• Valós idejű stream beállítások</li>
                  <li>• Stabil WebRTC kapcsolat</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Funkciók bemutatása */}
        <div className="mt-16">
          <h2 className="text-3xl font-bold text-center mb-12">
            ✨ Főbb funkciók
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🎥</div>
                <h3 className="card-title justify-center mb-2">
                  Többkamerás streaming
                </h3>
                <p className="text-base-content/70">
                  Több eszköz egyidejű streamelése egy központi helyre. 
                  Tökéletes eseményekhez és stúdió munkához.
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">⚙️</div>
                <h3 className="card-title justify-center mb-2">
                  Teljes kontroll
                </h3>
                <p className="text-base-content/70">
                  Felbontás, FPS, bitráta beállítások valós időben. 
                  Kép forgatása, tükrözése és optimalizálás.
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">📺</div>
                <h3 className="card-title justify-center mb-2">
                  OBS integráció
                </h3>
                <p className="text-base-content/70">
                  Egyedi kamera nézetek Browser Source-ként. 
                  Könnyen beilleszthető OBS-be vagy más streaming szoftverbe.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Technikai információk */}
        <div className="mt-16 card bg-base-100 shadow-xl max-w-4xl mx-auto">
          <div className="card-body">
            <h2 className="card-title text-2xl justify-center mb-6">
              🔧 Technikai részletek
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-bold mb-3">Támogatott felbontások:</h3>
                <ul className="space-y-1 text-sm">
                  <li>• 480p (854×480)</li>
                  <li>• 720p (1280×720) - ajánlott</li>
                  <li>• 1080p (1920×1080)</li>
                </ul>
              </div>
              
              <div>
                <h3 className="font-bold mb-3">Stream beállítások:</h3>
                <ul className="space-y-1 text-sm">
                  <li>• FPS: 15-60 között</li>
                  <li>• Bitráta: 500-8000 kbps</li>
                  <li>• WebRTC P2P kapcsolat</li>
                </ul>
              </div>
              
              <div>
                <h3 className="font-bold mb-3">Böngésző támogatás:</h3>
                <ul className="space-y-1 text-sm">
                  <li>• Chrome/Edge (ajánlott)</li>
                  <li>• Firefox</li>
                  <li>• Safari (iOS/macOS)</li>
                </ul>
              </div>
              
              <div>
                <h3 className="font-bold mb-3">OBS Browser Source:</h3>
                <ul className="space-y-1 text-sm">
                  <li>• Egyedi URL minden kamerához</li>
                  <li>• Fullscreen támogatás</li>
                  <li>• Automatikus újracsatlakozás</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-16 text-base-content/60">
          <p>© 2024 TStream - Vezeték nélküli kamera streaming platform</p>
        </div>
      </div>
    </div>
  );
};

export default HomePage;