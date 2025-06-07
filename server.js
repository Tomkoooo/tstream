const { createServer } = require('http');
const { Server } = require('socket.io');
const next = require('next');
const { parse } = require('url');

const port = parseInt(process.env.PORT || '3000', 10);
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
  });

  io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('create-room', (roomId, name, password) => {
      console.log(`Creating room: ${roomId}, name: ${name}, admin: ${socket.id}`);
      rooms[roomId] = { 
        name, 
        password, 
        participants: new Set(), 
        adminSocketId: socket.id,
        createdAt: Date.now()
      };
      socket.join(roomId);
      socket.broadcast.emit('room-created', roomId);
      io.to(roomId).emit('participants', Array.from(rooms[roomId].participants));
      console.log(`Room created: ${roomId}, admin: ${socket.id}`);
    });

    socket.on('join-room', (roomId, password, callback) => {
      console.log(`Join attempt: roomId=${roomId}, socketId=${socket.id}, password=${password}`);
      if (!rooms[roomId]) {
        console.log(`Room not found: ${roomId}`);
        callback(false, 'Room does not exist');
        return;
      }

      // Admin csatlakozhat jelszó nélkül
      if (socket.id === rooms[roomId].adminSocketId) {
        console.log(`Admin join: ${socket.id} joined ${roomId}`);
        rooms[roomId].participants.add(socket.id);
        socket.join(roomId);
        io.to(roomId).emit('participants', Array.from(rooms[roomId].participants));
        callback(true);
        return;
      }

      // Kliens jelszóval csatlakozik
      if (rooms[roomId].password !== password) {
        console.log(`Incorrect password for room: ${roomId}`);
        callback(false, 'Incorrect password');
        return;
      }

      rooms[roomId].participants.add(socket.id);
      socket.join(roomId);
      console.log(`Join successful: ${socket.id} joined ${roomId}`);
      socket.to(roomId).emit('user-joined', socket.id);
      io.to(roomId).emit('participants', Array.from(rooms[roomId].participants));
      callback(true);
    });

    socket.on('offer', (offer, roomId, fromSocketId) => {
      console.log(`Offer received from ${fromSocketId} for room ${roomId}`);
      socket.to(roomId).emit('offer', offer, fromSocketId);
    });

    socket.on('answer', (answer, roomId, fromSocketId) => {
      console.log(`Answer received from ${fromSocketId} for room ${roomId}`);
      socket.to(roomId).emit('answer', answer, fromSocketId);
    });

    socket.on('ice-candidate', (candidate, roomId, fromSocketId) => {
      console.log(`ICE candidate received from ${fromSocketId} for room ${roomId}`);
      socket.to(roomId).emit('ice-candidate', candidate, fromSocketId);
    });

    socket.on('kick-user', (roomId, targetSocketId) => {
      console.log(`Kick request: ${socket.id} wants to kick ${targetSocketId} from room ${roomId}`);
      
      // Ellenőrizzük, hogy a szoba létezik-e
      if (!rooms[roomId]) {
        console.log(`Room ${roomId} not found`);
        return;
      }

      // Ellenőrizzük, hogy a kérő admin-e
      if (rooms[roomId].adminSocketId !== socket.id) {
        console.log(`Unauthorized kick attempt by ${socket.id} in room ${roomId}`);
        console.log(`Admin socket ID: ${rooms[roomId].adminSocketId}, Requester socket ID: ${socket.id}`);
        return;
      }

      // Ellenőrizzük, hogy a cél felhasználó a szobában van-e
      if (!rooms[roomId].participants.has(targetSocketId)) {
        console.log(`Target user ${targetSocketId} not found in room ${roomId}`);
        return;
      }

      // Küldjük a kick eseményt a cél felhasználónak
      io.to(targetSocketId).emit('kicked', roomId);
      
      // Távolítsuk el a felhasználót a szobából
      rooms[roomId].participants.delete(targetSocketId);
      
      // Értesítsük a többi felhasználót
      io.to(roomId).emit('participants', Array.from(rooms[roomId].participants));
      console.log(`User ${targetSocketId} has been kicked from room ${roomId}`);

      // Küldjünk visszajelzést az adminnak
      socket.emit('kick-success', targetSocketId);
    });

    socket.on('disconnect', () => {
      console.log(`Disconnect: ${socket.id}`);
      for (const roomId in rooms) {
        if (rooms[roomId].participants.has(socket.id)) {
          rooms[roomId].participants.delete(socket.id);
          console.log(`Removed ${socket.id} from room ${roomId}`);
          io.to(roomId).emit('participants', Array.from(rooms[roomId].participants));
          socket.to(roomId).emit('user-left', socket.id);
        }
        if (rooms[roomId].adminSocketId === socket.id) {
          console.log(`Admin disconnected from room ${roomId}`);
          delete rooms[roomId].adminSocketId;
        }
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Server listening at http://localhost:${port}`);
  });
});