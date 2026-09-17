import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import webpush from 'web-push';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 8080);
const publicUrl = (() => { try { const url = new URL(process.env.PUBLIC_URL); return ['http:', 'https:'].includes(url.protocol) ? url.origin : ''; } catch { return ''; } })();
const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, publicUrl, ...(process.env.ALLOWED_ORIGINS || '').split(',')].filter(Boolean).map(value => {
  const u = new URL(value.trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.origin !== value.trim()) throw new Error('Origins must be exact HTTP(S) origins');
  return u.origin;
}));
const allowedHosts = new Set([...allowedOrigins].map(origin => new URL(origin).host));
const validRequestOrigin = req => allowedHosts.has(req.headers.host) && (!req.headers.origin || allowedOrigins.has(req.headers.origin));
let mintWindow = Date.now(), minted = 0, inFlightPush = 0;
const keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : webpush.generateVAPIDKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', keys.publicKey, keys.privateKey);
// Routing and opt-in delivery addresses only. No filesystem writes, call logs or recordings.
const rooms = new Map();
const DAY = 86400000;
function relayConfig() {
  if (!process.env.TURN_URLS || !process.env.TURN_SECRET) return undefined;
  const username = `${Math.floor(Date.now() / 1000) + 600}:${randomBytes(8).toString('hex')}`;
  return [{ urls: process.env.TURN_URLS.split(',').filter(url => /^turns?:/.test(url)), username, credential: createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') }];
}
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validRoom = id => typeof id === 'string' && /^line-[a-f0-9]{32}$/.test(id);
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const compressed = new Map();
function serve(file, req, res) {
  const stat = fs.statSync(file);
  const hashed = /[/\\]assets[/\\]/.test(file);
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const key = `${file}:${stat.mtimeMs}:${gzip}`;
  let data = compressed.get(key);
  if (!data) {
    let raw = fs.readFileSync(file);
    if (publicUrl && path.extname(file) === '.html') {
      const pathname = path.basename(file) === 'index.html' ? '/' : '/' + path.basename(file);
      raw = Buffer.from(raw.toString().replace('</head>', `<link rel="canonical" href="${publicUrl}${pathname}"><meta property="og:url" content="${publicUrl}${pathname}"></head>`));
    }
    data = gzip ? zlib.gzipSync(raw) : raw;
    if (compressed.size > 100) compressed.clear();
    compressed.set(key, data);
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': hashed ? 'public,max-age=31536000,immutable' : 'no-cache', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(data);
}
async function bodyOf(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 12000) throw new Error('Body too large'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
  return value;
}
function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${[...allowedOrigins].map(origin => origin.replace(/^http/, 'ws')).join(' ')}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
  if (publicUrl.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (!validRequestOrigin(req)) return json(res, 403, { error: 'Origin not allowed' });
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'Invalid URL' }); }
  if (url.search) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (url.pathname === '/robots.txt' && publicUrl) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /ws\nDisallow: /health\nSitemap: ${publicUrl}/sitemap.xml\n`); }
  if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
  if (url.pathname === '/api/config') return json(res, 200, { publicUrl, vapidPublicKey: keys.publicKey, pushRetentionHours: 24, relayConfigured: !!(process.env.TURN_URLS && process.env.TURN_SECRET) });
  if (req.method === 'POST' && ['/api/ice', '/api/push-subscribe', '/api/push-unsubscribe'].includes(url.pathname)) {
    try {
      const { roomId, subscription, deviceId } = await bodyOf(req);
      const room = rooms.get(roomId);
      if (!room || !equal(req.headers.authorization?.replace(/^Bearer /, ''), room.auth) || !/^[a-f0-9]{32}$/.test(deviceId || '')) return json(res, 403, { error: 'Open your private connection first' });
      if (!url.pathname.endsWith('unsubscribe') && ![...room.clients].some(client => client.deviceId === deviceId)) return json(res, 403, { error: 'Device must have an active connection' });
      if (url.pathname === '/api/ice') {
        if (Date.now() - mintWindow > 60000) { mintWindow = Date.now(); minted = 0; }
        const previous = room.iceIssued.get(deviceId) || 0;
        if (Date.now() - previous < 10000 || minted >= 120) return json(res, 429, { error: 'Relay credential rate limit' });
        room.iceIssued.set(deviceId, Date.now()); minted++;
        return json(res, 200, { iceServers: relayConfig() || [] });
      }
      if (url.pathname.endsWith('unsubscribe')) { room.push.delete(deviceId); return json(res, 200, { success: true }); }
      if (!allowedEndpoint(subscription?.endpoint) || typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string' || !/^[A-Za-z0-9_-]{87}=?$/.test(subscription.keys.p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(subscription.keys.auth)) return json(res, 400, { error: 'Unsupported push subscription' });
      if (room.push.size >= 2 && !room.push.has(deviceId)) return json(res, 409, { error: 'Two devices are already subscribed' });
      room.push.set(deviceId, { subscription, expires: Date.now() + DAY });
      return json(res, 200, { success: true });
    } catch { return json(res, 400, { error: 'Invalid request' }); }
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  // Canonical and sitemap use the configured deployment URL; never invent a domain.
  if (url.pathname === '/sitemap.xml') {
    if (!publicUrl) return json(res, 503, { error: 'Set PUBLIC_URL for the deployment sitemap' });
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    const safe = publicUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/about.html', '/privacy.html'].map(p => `<url><loc>${safe}${p}</loc></url>`).join('')}</urlset>`);
  }
  let file;
  try { file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`); } catch { return json(res, 400, { error: 'Invalid path' }); }
  if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
  serve(file, req, res);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxConnections = 1200;
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || (!validRequestOrigin(req) || !req.headers.origin) || wss.clients.size >= 1000) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
const allowedTypes = new Set(['call-ring', 'call-accept', 'call-decline', 'call-cancel', 'call-ended', 'offer', 'answer', 'candidate', 'profile-change', 'contact-deleted']);
const send = (ws, msg) => { if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); return; } if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
wss.on('connection', ws => {
  let current = null, device = '', count = 0, windowStart = Date.now();
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const joinTimeout = setTimeout(() => { if (!current) ws.close(1008); }, 10000);
  ws.on('message', raw => {
    if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }
    if (++count > 150) return ws.close(1008, 'Rate limit');
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'join') {
        if (current || !validRoom(msg.roomId) || !validToken(msg.auth) || !/^[a-f0-9]{32}$/.test(msg.deviceId || '')) return ws.close(1008);
        let room = rooms.get(msg.roomId);
        if (!room) {
          if (rooms.size >= 5000) return ws.close(1013);
          room = { auth: msg.auth, clients: new Set(), push: new Map(), pending: null, lastRing: new Map(), iceIssued: new Map() };
          rooms.set(msg.roomId, room);
        }
        if (!equal(room.auth, msg.auth)) return ws.close(1008);
        if (room.clients.size >= 2) { send(ws, { type: 'room-full' }); return ws.close(1008); }
        current = msg.roomId; device = msg.deviceId; clearTimeout(joinTimeout);
        ws.deviceId = device; room.clients.add(ws);
        send(ws, { type: 'joined', isInitiator: room.clients.size === 1, peersCount: room.clients.size });
        for (const peer of room.clients) if (peer !== ws) send(peer, { type: 'peer-joined' });
        if (room.pending && room.pending.expires > Date.now() && room.pending.device !== device) send(ws, room.pending.message);
        return;
      }
      const room = rooms.get(current);
      if (!room || !room.clients.has(ws) || !allowedTypes.has(msg.type) || !Array.isArray(msg.payload?.iv) || msg.payload.iv.length !== 12 || typeof msg.payload?.data !== 'string' || msg.payload.iv.some(n => !Number.isInteger(n) || n < 0 || n > 255) || msg.payload.data.length > 100000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(msg.payload.data) || msg.payload.data.length % 4 !== 0) return ws.close(1008, 'Invalid signal');
      const message = { type: msg.type, payload: msg.payload };
      if (msg.type === 'call-ring') {
        if (Date.now() - (room.lastRing.get(device) || 0) < 3000) { send(ws, { type: 'error', message: 'Please wait a few seconds before calling again.' }); return; }
        if (room.lastRing.size > 10) room.lastRing.clear();
        room.lastRing.set(device, Date.now());
        room.pending = { device, message, expires: Date.now() + 90000 };
        for (const [target, entry] of room.push) {
          if (target === device || entry.expires <= Date.now() || inFlightPush >= 32) continue;
          inFlightPush++;
          webpush.sendNotification(entry.subscription, JSON.stringify({ title: 'Incoming ImiCall', body: 'Someone on your private line is calling. Open to answer.', url: `/#wake=${current}` }), { TTL: 90, urgency: 'high', timeout: 5000 }).catch(error => {
            if ([404, 410].includes(error.statusCode)) room.push.delete(target);
          }).finally(() => { inFlightPush--; });
        }
      }
      if (['call-accept', 'call-cancel', 'call-ended', 'call-decline'].includes(msg.type)) room.pending = null;
      if (msg.type === 'contact-deleted') room.push.delete(device);
      for (const peer of room.clients) if (peer !== ws) send(peer, message);
    } catch { ws.close(1008, 'Invalid message'); }
  });
  ws.on('close', () => {
    clearTimeout(joinTimeout);
    const room = rooms.get(current);
    if (!room) return;
    room.clients.delete(ws);
    room.iceIssued.delete(device);
    if (room.pending?.device === device) room.pending = null;
    for (const peer of room.clients) send(peer, { type: 'peer-left' });
    if (!room.clients.size && !room.push.size) rooms.delete(current);
  });
  ws.on('error', () => {});
});
const sweep = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  for (const [id, room] of rooms) {
    for (const [device, entry] of room.push) if (entry.expires <= Date.now()) room.push.delete(device);
    if (room.pending?.expires <= Date.now()) room.pending = null;
    if (!room.clients.size && !room.push.size) rooms.delete(id);
  }
}, 30000);
sweep.unref();
server.listen(port, () => console.log(`ImiCall listening on ${port}; routing and push data are memory-only.`));
