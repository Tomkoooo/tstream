'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';

const Home: React.FC = () => {
  const [roomName, setRoomName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const socket = useRef<Socket | null>(null);

  const handleCreateRoom = () => {
    if (!roomName || !password) {
      setError('Room name and password are required');
      return;
    }

    const roomId = Math.random().toString(36).substring(2, 10);
    socket.current = io({ path: '/api/socket', transports: ['websocket'] });
    socket.current.emit('create-room', roomId, roomName, password);
    router.push(`/admin/${roomId}?=${encodeURIComponent(roomName)}&password=${encodeURIComponent(password)}`);
  };

  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-4">Create a Room</h1>
        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}
        <div className="form-control w-full max-w-xs">
          <label className="label">
            <span className="label-text">Room Name</span>
          </label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="input input-bordered w-full"
            placeholder="Enter room name"
          />
          <label className="label">
            <span className="label-text">Password</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input input-bordered w-full"
            placeholder="Enter password"
          />
          <button className="btn btn-primary mt-4" onClick={handleCreateRoom}>
            Create Room
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;