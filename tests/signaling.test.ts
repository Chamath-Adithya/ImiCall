import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';

describe('Signaling Protocol & Room Pairing', () => {
  let wss: WebSocketServer;
  const PORT = 8089;
  const rooms = new Map<string, Set<WebSocket>>();

  beforeAll(async () => {
    wss = new WebSocketServer({ port: PORT });
    wss.on('connection', (ws) => {
      let currentRoom: string | null = null;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'join') {
          currentRoom = msg.roomId;
          if (!rooms.has(currentRoom!)) rooms.set(currentRoom!, new Set());
          const clients = rooms.get(currentRoom!)!;
          clients.add(ws);
          ws.send(JSON.stringify({ type: 'joined', isInitiator: clients.size === 1 }));
          if (clients.size === 2) {
            for (const client of clients) {
              if (client !== ws) client.send(JSON.stringify({ type: 'peer-joined' }));
            }
          }
        }
      });
    });
  });

  afterAll(() => {
    wss.close();
  });

  it('should pair two clients in the same room as initiator and peer', async () => {
    const ws1 = new WebSocket(`ws://localhost:${PORT}`);
    const ws2 = new WebSocket(`ws://localhost:${PORT}`);

    await Promise.all([
      new Promise((res) => ws1.on('open', res)),
      new Promise((res) => ws2.on('open', res)),
    ]);

    const msg1Promise = new Promise<any>((res) => ws1.on('message', (d) => res(JSON.parse(d.toString()))));
    ws1.send(JSON.stringify({ type: 'join', roomId: 'test-room-1' }));
    const msg1 = await msg1Promise;
    expect(msg1.type).toBe('joined');
    expect(msg1.isInitiator).toBe(true);

    const peerJoinedPromise = new Promise<any>((res) => ws1.on('message', (d) => res(JSON.parse(d.toString()))));
    ws2.send(JSON.stringify({ type: 'join', roomId: 'test-room-1' }));
    const peerJoined = await peerJoinedPromise;
    expect(peerJoined.type).toBe('peer-joined');

    ws1.close();
    ws2.close();
  });
});
