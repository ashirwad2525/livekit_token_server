const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { AccessToken } = require('livekit-server-sdk');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// One waiting user at a time (Omegle-style 1-on-1 pairing).
let waitingUser = null; // { socketId, identity, userName }

// roomId -> [socketId, socketId], used to notify the other side on leave/disconnect.
const rooms = {};

function log(msg) {
  console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

async function mintToken(roomName, identity) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    ttl: '1h',
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });
  return at.toJwt();
}

function clearWaitingIfSelf(socketId) {
  if (waitingUser && waitingUser.socketId === socketId) {
    waitingUser = null;
  }
}

function notifyPartnerLeft(socketId) {
  for (const roomId in rooms) {
    const members = rooms[roomId];
    if (members.includes(socketId)) {
      const other = members.find((id) => id !== socketId);
      if (other) io.to(other).emit('partner_left');
      delete rooms[roomId];
      log(`Room ${roomId} closed (member ${socketId} left)`);
      break;
    }
  }
}

io.on('connection', (socket) => {
  log(`Connected: ${socket.id}`);

  socket.on('find_partner', async ({ identity, userName }) => {
    socket.data.identity = identity;
    socket.data.userName = userName;

    const candidate = waitingUser;
    const candidateAlive =
      candidate &&
      candidate.socketId !== socket.id &&
      io.sockets.sockets.get(candidate.socketId);

    if (candidateAlive) {
      waitingUser = null;
      const roomId = randomUUID();
      rooms[roomId] = [socket.id, candidate.socketId];

      try {
        const [myToken, theirToken] = await Promise.all([
          mintToken(roomId, identity),
          mintToken(roomId, candidate.identity),
        ]);

        socket.emit('matched', {
          roomId,
          token: myToken,
          peerName: candidate.userName,
        });
        io.to(candidate.socketId).emit('matched', {
          roomId,
          token: theirToken,
          peerName: userName,
        });

        log(`Matched ${socket.id} <-> ${candidate.socketId} in room ${roomId}`);
      } catch (e) {
        log(`Token mint failed: ${e.message}`);
        socket.emit('match_error', 'Failed to create call');
        delete rooms[roomId];
      }
    } else {
      waitingUser = { socketId: socket.id, identity, userName };
      log(`Waiting: ${socket.id}`);
    }
  });

  socket.on('cancel_search', () => {
    clearWaitingIfSelf(socket.id);
    log(`Cancelled search: ${socket.id}`);
  });

  socket.on('leave_room', ({ roomId }) => {
    if (roomId && rooms[roomId]) {
      const other = rooms[roomId].find((id) => id !== socket.id);
      if (other) io.to(other).emit('partner_left');
      delete rooms[roomId];
      log(`Room ${roomId} left by ${socket.id}`);
    }
  });

  socket.on('disconnect', () => {
    clearWaitingIfSelf(socket.id);
    notifyPartnerLeft(socket.id);
    log(`Disconnected: ${socket.id}`);
  });
});

app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => log(`Signaling + token server on ${PORT}`));
