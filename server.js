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
      console.log(`Creating room: ${roomId}, name: ${name}`);
      rooms[roomId] = { name, password, participants: new Set(), adminSocketId: socket.id };
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