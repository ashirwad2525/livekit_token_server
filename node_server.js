const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const LIVEKIT_API_KEY = process.env.APIi4uAvmF3zoeL;
const LIVEKIT_API_SECRET = process.env.bFBeOkEvfS7HjcTGT8XfX8oFsWF2tBnIewvben8XMq7C;

// POST /token  { roomName, identity }
app.post('/token', async (req, res) => {
  const { roomName, identity } = req.body;
  if (!roomName || !identity) {
    return res.status(400).json({ error: 'roomName and identity required' });
  }

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

  const token = await at.toJwt();
  res.json({ token });
});

app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Token server on ${PORT}`));
