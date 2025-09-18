const { createServer } = require('http');
const { Server } = require('socket.io');
const next = require('next');
const { parse } = require('url');

const port = 8080;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

let io = null;
const rooms = {};

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  io = new Server(server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Szoba létrehozása
    socket.on('create-room', (roomData, callback) => {
      const { roomId, name, password } = roomData;
      
      if (rooms[roomId]) {
        callback({ success: false, error: 'Room already exists' });
        return;
      }

      rooms[roomId] = {
        name,
        password,
        adminSocketId: socket.id,
        participants: new Map([[socket.id, {
          id: socket.id,
          isAdmin: true,
          hasVideo: false,
          hasAudio: false,
          streamSettings: {
            resolution: '720p',
            fps: 30,
            bitrate: 2000
          }
        }]]),
        createdAt: Date.now(),
      };

      socket.join(roomId);
      console.log(`Room created: ${roomId}, admin: ${socket.id}`);
      callback({ success: true, roomId });
    });

    // Szobához csatlakozás
    socket.on('join-room', (roomId, password, callback) => {
      if (!rooms[roomId]) {
        callback({ success: false, error: 'Room does not exist' });
        return;
      }

      const room = rooms[roomId];
      const isAdmin = socket.id === room.adminSocketId;
      
      if (!isAdmin && password !== room.password) {
        callback({ success: false, error: 'Incorrect password' });
        return;
      }

      // Participant hozzáadása
      room.participants.set(socket.id, {
        id: socket.id,
        isAdmin,
        hasVideo: false,
        hasAudio: false,
        streamSettings: {
          resolution: '720p',
          fps: 30,
          bitrate: 2000
        }
      });

      socket.join(roomId);
      
      // Értesítés a többieknek
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        isAdmin,
        participants: Array.from(room.participants.values())
      });

      // Résztvevők listájának küldése
      io.to(roomId).emit('participants-updated', Array.from(room.participants.values()));
      
      callback({ 
        success: true, 
        isAdmin,
        participants: Array.from(room.participants.values())
      });

      console.log(`User ${socket.id} joined room ${roomId}`);
    });

    // Stream beállítások frissítése
    socket.on('update-stream-settings', (roomId, settings) => {
      if (!rooms[roomId] || !rooms[roomId].participants.has(socket.id)) return;
      
      const participant = rooms[roomId].participants.get(socket.id);
      participant.streamSettings = { ...participant.streamSettings, ...settings };
      
      // Értesítés az adminnak
      if (socket.id !== rooms[roomId].adminSocketId) {
        socket.to(rooms[roomId].adminSocketId).emit('participant-settings-updated', {
          userId: socket.id,
          settings: participant.streamSettings
        });
      }
    });

    // Stream állapot frissítése
    socket.on('update-stream-status', (roomId, status) => {
      if (!rooms[roomId] || !rooms[roomId].participants.has(socket.id)) return;
      
      const participant = rooms[roomId].participants.get(socket.id);
      participant.hasVideo = status.hasVideo || false;
      participant.hasAudio = status.hasAudio || false;
      
      // Frissített résztvevők listájának küldése
      io.to(roomId).emit('participants-updated', Array.from(rooms[roomId].participants.values()));
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
      const { offer, roomId, targetId } = data;
      console.log(`Offer from ${socket.id} to ${targetId} in room ${roomId}`);
      if (targetId) {
        socket.to(targetId).emit('offer', {
          offer,
          fromId: socket.id,
          roomId
        });
      }
    });

    socket.on('answer', (data) => {
      const { answer, roomId, targetId } = data;
      console.log(`Answer from ${socket.id} to ${targetId} in room ${roomId}`);
      if (targetId) {
        socket.to(targetId).emit('answer', {
          answer,
          fromId: socket.id,
          roomId
        });
      }
    });

    socket.on('ice-candidate', (data) => {
      const { candidate, roomId, targetId } = data;
      if (targetId) {
        socket.to(targetId).emit('ice-candidate', {
          candidate,
          fromId: socket.id,
          roomId
        });
      }
    });

    // Admin funkciók
    socket.on('kick-user', (roomId, targetSocketId) => {
      if (!rooms[roomId] || rooms[roomId].adminSocketId !== socket.id) {
        return;
      }

      if (rooms[roomId].participants.has(targetSocketId)) {
        // Értesítés a kirúgott felhasználónak
        io.to(targetSocketId).emit('kicked', roomId);
        
        // Eltávolítás a szobából
        rooms[roomId].participants.delete(targetSocketId);
        
        // Frissített résztvevők listájának küldése
        io.to(roomId).emit('participants-updated', Array.from(rooms[roomId].participants.values()));
        
        // Értesítés a többieknek
        socket.to(roomId).emit('user-left', targetSocketId);
        
        socket.emit('kick-success', targetSocketId);
        console.log(`User ${targetSocketId} kicked from room ${roomId}`);
      }
    });

    // Szoba információk lekérése
    socket.on('get-room-info', (roomId, callback) => {
      if (!rooms[roomId]) {
        callback({ success: false, error: 'Room not found' });
        return;
      }

      callback({
        success: true,
        room: {
          id: roomId,
          name: rooms[roomId].name,
          participants: Array.from(rooms[roomId].participants.values()),
          isAdmin: socket.id === rooms[roomId].adminSocketId
        }
      });
    });

    // Kapcsolat megszakadása
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      
      for (const roomId in rooms) {
        const room = rooms[roomId];
        
        if (room.participants.has(socket.id)) {
          room.participants.delete(socket.id);
          
          // Értesítés a többieknek
          socket.to(roomId).emit('user-left', socket.id);
          io.to(roomId).emit('participants-updated', Array.from(room.participants.values()));
          
          // Ha az admin távozott és vannak még résztvevők
          if (room.adminSocketId === socket.id && room.participants.size > 0) {
            const newAdminId = Array.from(room.participants.keys())[0];
            room.adminSocketId = newAdminId;
            
            const newAdmin = room.participants.get(newAdminId);
            newAdmin.isAdmin = true;
            
            io.to(newAdminId).emit('admin-assigned', roomId);
            io.to(roomId).emit('participants-updated', Array.from(room.participants.values()));
            
            console.log(`New admin assigned in room ${roomId}: ${newAdminId}`);
          }
          
          // Ha nincs több résztvevő, töröljük a szobát
          if (room.participants.size === 0) {
            delete rooms[roomId];
            console.log(`Room ${roomId} deleted (no participants)`);
          }
        }
      }
    });

    // Hibaelhárítás
    socket.on('error', (error) => {
      console.error(`Socket error from ${socket.id}:`, error);
    });
  });

  server.listen(port, () => {
    console.log(`> Server listening at http://localhost:${port}`);
  });
});