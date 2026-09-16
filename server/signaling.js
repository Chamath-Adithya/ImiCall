import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ImiCall Signaling Server (Ultra-Low Latency WebSocket)');
});

const wss = new WebSocketServer({ server });

// Map of roomId -> Set of WebSocket clients
const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { type, roomId, payload } = message;

      if (type === 'join') {
        currentRoom = roomId;
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }

        const roomClients = rooms.get(roomId);
        if (roomClients.size >= 2) {
          ws.send(JSON.stringify({ type: 'room-full', message: 'Room already has 2 participants.' }));
          return;
        }

        roomClients.add(ws);
        const isInitiator = roomClients.size === 1;

        ws.send(JSON.stringify({
          type: 'joined',
          roomId,
          isInitiator,
          peersCount: roomClients.size
        }));

        if (roomClients.size === 2) {
          // Notify the initiator that peer has joined
          for (const client of roomClients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'peer-joined' }));
            }
          }
        }
        return;
      }

      // Forward WebRTC signals (offer, answer, candidate, profile-change) to the other peer in the room
      if (currentRoom && rooms.has(currentRoom)) {
        const roomClients = rooms.get(currentRoom);
        for (const client of roomClients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type,
              payload,
              senderId: ws._id
            }));
          }
        }
      }
    } catch (err) {
      console.error('[Signaling] Message error:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const roomClients = rooms.get(currentRoom);
      roomClients.delete(ws);
      if (roomClients.size === 0) {
        rooms.delete(currentRoom);
      } else {
        for (const client of roomClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'peer-left' }));
          }
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[Signaling] Client error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`[ImiCall] Signaling server running on port ${PORT}`);
});
