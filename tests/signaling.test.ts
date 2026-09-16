import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
const port = 18189, base = `http://localhost:${port}`;
let server: ChildProcess;
const sockets: WebSocket[] = [];
const next = (ws: WebSocket) => new Promise<any>(resolve => ws.once('message', d => resolve(JSON.parse(d.toString()))));
async function socket() { const ws = new WebSocket(`ws://localhost:${port}/ws`); sockets.push(ws); await new Promise(r => ws.once('open', r)); return ws; }
beforeAll(async () => { server = spawn(process.execPath, ['server/signaling.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }); await new Promise<void>((resolve, reject) => { server.stdout!.once('data', () => resolve()); server.once('error', reject); }); });
afterAll(() => { sockets.forEach(ws => ws.terminate()); server.kill(); });
describe('Actual production relay', () => {
 it('rejects unauthenticated APIs and provides browser security headers', async () => {
   const r = await fetch(base); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
   expect((await fetch(base + '/api/deleted-connections')).status).toBe(404);
   expect((await fetch(base + '/api/push-subscribe', { method: 'POST', body: JSON.stringify({ roomId: 'nope' }) })).status).toBe(403);
   expect((await fetch(base + '/api/config', { headers: { Origin: 'https://evil.invalid' } })).status).toBe(403);
 });
 it('pairs only authenticated room members and rejects duplicate joins and third peers', async () => {
   const roomId = 'line-' + randomBytes(16).toString('hex'), auth = randomBytes(32).toString('hex');
   const join = { type: 'join', roomId, auth, deviceId: randomBytes(16).toString('hex') };
   const a = await socket(); let reply = next(a); a.send(JSON.stringify(join)); expect((await reply).type).toBe('joined');
   const bad = await socket(); const closed = new Promise(r => bad.once('close', r)); bad.send(JSON.stringify({ ...join, auth: '0'.repeat(64) })); await closed;
   const b = await socket(); reply = next(b); b.send(JSON.stringify({ ...join, deviceId: randomBytes(16).toString('hex') })); expect((await reply).peersCount).toBe(2);
   const third = await socket(); reply = next(third); third.send(JSON.stringify(join)); expect((await reply).type).toBe('room-full');
   reply = next(b); a.send(JSON.stringify({ type: 'offer', payload: { iv: Array(12).fill(1), data: 'encrypted' } })); expect((await reply).payload.data).toBe('encrypted');
   const duplicateClosed = new Promise(r => a.once('close', r)); a.send(JSON.stringify(join)); await duplicateClosed;
   b.close();
 });
});
