const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { AccessToken } = require('livekit-server-sdk');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const AUDIO_LIVEKIT_URL =
  process.env.LIVEKIT_AUDIO_URL || 'wss://livekit.yourdomain.com';
const AUDIO_LIVEKIT_API_KEY = process.env.LIVEKIT_AUDIO_API_KEY;
const AUDIO_LIVEKIT_API_SECRET = process.env.LIVEKIT_AUDIO_API_SECRET;

const VIDEO_LIVEKIT_URL =
  process.env.LIVEKIT_VIDEO_URL || 'wss://beingle-mwlb5tsa.livekit.cloud';
const VIDEO_LIVEKIT_API_KEY = process.env.LIVEKIT_VIDEO_API_KEY;
const VIDEO_LIVEKIT_API_SECRET = process.env.LIVEKIT_VIDEO_API_SECRET;

let waitingUsers = { video: null, audio: null };
const rooms = {};

function log(msg) {
  console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

function getLiveKitConfig(callType) {
  if (callType === 'audio') {
    return {
      url: AUDIO_LIVEKIT_URL,
      apiKey: AUDIO_LIVEKIT_API_KEY,
      apiSecret: AUDIO_LIVEKIT_API_SECRET,
    };
  }

  return {
    url: VIDEO_LIVEKIT_URL,
    apiKey: VIDEO_LIVEKIT_API_KEY,
    apiSecret: VIDEO_LIVEKIT_API_SECRET,
  };
}

async function mintToken(roomName, identity, callType) {
  const cfg = getLiveKitConfig(callType);

  if (!cfg.apiKey || !cfg.apiSecret || !cfg.url) {
    throw new Error(`Missing LiveKit config for ${callType}`);
  }

  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity,
    ttl: '1h',
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return {
    token,
    livekitUrl: cfg.url,
  };
}

function clearWaitingIfSelf(socketId) {
  for (const type of Object.keys(waitingUsers)) {
    if (waitingUsers[type] && waitingUsers[type].socketId === socketId) {
      waitingUsers[type] = null;
    }
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

  socket.on('find_partner', async ({ identity, userName, callType }) => {
    const type = callType === 'audio' ? 'audio' : 'video';

    socket.data.identity = identity;
    socket.data.userName = userName;
    socket.data.callType = type;

    const candidate = waitingUsers[type];
    const candidateAlive =
      candidate &&
      candidate.socketId !== socket.id &&
      io.sockets.sockets.get(candidate.socketId);

    if (candidateAlive) {
      waitingUsers[type] = null;
      const roomId = randomUUID();
      rooms[roomId] = [socket.id, candidate.socketId];

      try {
        const [myJoin, theirJoin] = await Promise.all([
          mintToken(roomId, identity, type),
          mintToken(roomId, candidate.identity, type),
        ]);

        socket.emit('matched', {
          roomId,
          token: myJoin.token,
          livekitUrl: myJoin.livekitUrl,
          peerName: candidate.userName,
        });

        io.to(candidate.socketId).emit('matched', {
          roomId,
          token: theirJoin.token,
          livekitUrl: theirJoin.livekitUrl,
          peerName: userName,
        });

        log(`Matched (${type}) ${socket.id} <-> ${candidate.socketId} in room ${roomId}`);
      } catch (e) {
        log(`Token mint failed for ${type}: ${e.message}`);
        socket.emit('match_error', 'Failed to create call');
        io.to(candidate.socketId).emit('match_error', 'Failed to create call');
        delete rooms[roomId];
      }
    } else {
      waitingUsers[type] = { socketId: socket.id, identity, userName };
      log(`Waiting (${type}): ${socket.id}`);
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
