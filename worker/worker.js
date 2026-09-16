/**
 * Cloudflare Worker for ImiCall Signaling.
 * Deploys globally across 300+ Cloudflare Edge locations (including Colombo, Sri Lanka CMB PoP).
 * Uses Cloudflare Durable Objects for low-latency in-memory WebSocket room pairing.
 */

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // webSocket -> session info
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();

    if (this.sessions.size >= 2) {
      server.send(JSON.stringify({ type: 'room-full', message: 'Room has reached max 2 participants.' }));
      server.close(1008, 'Room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const isInitiator = this.sessions.size === 0;
    this.sessions.set(server, { isInitiator });

    server.send(JSON.stringify({
      type: 'joined',
      isInitiator,
      peersCount: this.sessions.size
    }));

    if (this.sessions.size === 2) {
      for (const [ws, info] of this.sessions.entries()) {
        if (ws !== server) {
          ws.send(JSON.stringify({ type: 'peer-joined' }));
        }
      }
    }

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Relay to other peer
        for (const [ws] of this.sessions.entries()) {
          if (ws !== server) {
            ws.send(event.data);
          }
        }
      } catch (err) {
        console.error('Error parsing signaling message:', err);
      }
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
      for (const [ws] of this.sessions.entries()) {
        ws.send(JSON.stringify({ type: 'peer-left' }));
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'imicall-edge-signaling' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.startsWith('/ws')) {
      const roomId = url.searchParams.get('room') || 'default';
      const id = env.ROOM_DO.idFromName(roomId);
      const roomObject = env.ROOM_DO.get(id);
      return roomObject.fetch(request);
    }

    return new Response('ImiCall Cloudflare Edge Signaling Active.', { status: 200 });
  },
};
