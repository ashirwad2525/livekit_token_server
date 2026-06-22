const express = require('express');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(express.json());

const LIVEKIT_API_KEY = process.env.APIi4uAvmF3zoeL;
const LIVEKIT_API_SECRET = process.env.bFBeOkEvfS7HjcTGT8XfX8oFsWF2tBnIewvben8XMq7C;
const LIVEKIT_URL = "wss://beingle-mwlb5tsa.livekit.cloud";

app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;
  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'roomName and participantName required' });
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantName,
  });

  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  const token = await at.toJwt();
  res.json({ token, url: LIVEKIT_URL });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Token server running on port ${PORT}`));