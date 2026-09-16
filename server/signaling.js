import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const PORT = process.env.PORT || 8080;

const VAPID_PUBLIC_KEY = 'BOuJcOk-mNS1r3WsBBtmDY5wnqKSdPmbcUe-_bv7I8h9ptc3ILFsWJ8iko0iY3qIhQEeIRH0T_wSu1f3Z7_7WsA';
const VAPID_PRIVATE_KEY = 'Q8u9SokW2n1Ykeimkk2qEOrTtDxQiaa-a_SINIxEJ9g';

webpush.setVapidDetails(
  'mailto:support@imicall.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Map of roomId -> Map of endpoint -> subscription
const pushSubscriptions = new Map();

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), rooms: rooms.size }));
    return;
  }

  // VAPID public key endpoint
  if (req.url === '/api/vapid-public-key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }));
    return;
  }

  // Push Subscription registration
  if (req.method === 'POST' && req.url === '/api/push-subscribe') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { roomId, subscription } = JSON.parse(body);
        if (roomId && subscription && subscription.endpoint) {
          const roomKey = roomId.trim().toLowerCase();
          if (!pushSubscriptions.has(roomKey)) {
            pushSubscriptions.set(roomKey, new Map());
          }
          pushSubscriptions.get(roomKey).set(subscription.endpoint, subscription);
          console.log(`[Push] Registered subscription for room: ${roomKey}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Serve service worker sw.js directly if requested
  if (req.url === '/sw.js') {
    const swPath = fs.existsSync(path.join(DIST_DIR, 'sw.js'))
      ? path.join(DIST_DIR, 'sw.js')
      : path.join(PUBLIC_DIR, 'sw.js');
    if (fs.existsSync(swPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(swPath).pipe(res);
      return;
    }
  }

  // Static file serving from dist/
  if (fs.existsSync(DIST_DIR)) {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') {
      reqPath = '/index.html';
    }

    let filePath = path.join(DIST_DIR, reqPath);

    // Prevent directory traversal
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Fallback to index.html for client-side routing
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ImiCall Signaling Server (Ultra-Low Latency WebSocket & Web Push)');
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
          for (const client of roomClients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'peer-joined' }));
            }
          }
        }
        return;
      }

      // If call-ring, send background Web Push notification to partner even if browser is closed!
      if (type === 'call-ring' && currentRoom) {
        const roomKey = currentRoom.trim().toLowerCase();
        const subs = pushSubscriptions.get(roomKey);
        if (subs && subs.size > 0) {
          const pushPayload = JSON.stringify({
            title: '📞 Incoming Call — ImiCall',
            body: 'Your partner is calling on your dedicated line. Tap to answer!',
            lineId: roomKey,
            url: `/#line=${encodeURIComponent(roomKey)}&pin=2023`,
          });

          for (const [endpoint, sub] of subs.entries()) {
            webpush.sendNotification(sub, pushPayload, { TTL: 60, urgency: 'high' })
              .catch((err) => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                  subs.delete(endpoint);
                }
              });
          }
        }
      }

      // Forward all signaling messages (call-ring, call-accept, call-decline, call-cancel, call-ended, offer, answer, candidate, profile-change)
      if (currentRoom && rooms.has(currentRoom)) {
        const roomClients = rooms.get(currentRoom);
        for (const client of roomClients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type,
              payload,
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
  console.log(`[ImiCall] Server listening on port ${PORT} (Unified Static + WebSocket)`);
});
