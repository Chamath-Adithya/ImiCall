import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
const port = 18189, base = `http://localhost:${port}`;
let server: ChildProcess;
const sockets: WebSocket[] = [];
const next = (ws: WebSocket) => new Promise<any>(resolve => ws.once('message', d => resolve(JSON.parse(d.toString()))));
async function socket() { const ws = new WebSocket(`ws://localhost:${port}/ws`, { origin: base }); sockets.push(ws); await new Promise(r => ws.once('open', r)); return ws; }
beforeAll(async () => { server = spawn(process.execPath, ['server/signaling.js'], { env: { ...process.env, PORT: String(port), PUBLIC_URL: base, TURN_URLS: 'turn:relay.example.test:3478', TURN_SECRET: 'test-only-not-a-real-relay-secret' }, stdio: ['ignore', 'pipe', 'pipe'] }); await new Promise<void>((resolve, reject) => { server.stdout!.once('data', () => resolve()); server.once('error', reject); }); });
afterAll(() => { sockets.forEach(ws => ws.terminate()); server.kill(); });
describe('Actual production relay', () => {
 it('rejects unauthenticated APIs and provides browser security headers', async () => {
   const r = await fetch(base); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
   const config = await (await fetch(base + '/api/config')).json(); expect(config.iceServers).toBeUndefined(); expect(config.relayConfigured).toBe(true);
   expect((await fetch(base + '/api/ice', {method:'POST',body:JSON.stringify({})})).status).toBe(403);
   expect(await new Promise<number|undefined>((resolve,reject)=>{http.get(base+'/health',{headers:{Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);})).toBe(403);
   expect(r.headers.get('content-security-policy')).not.toContain(' ws: wss:');
   expect((await fetch(base + '/api/deleted-connections')).status).toBe(404);
   expect((await fetch(base + '/api/push-subscribe', { method: 'POST', body: JSON.stringify({ roomId: 'nope' }) })).status).toBe(403);
   expect((await fetch(base + '/api/config', { headers: { Origin: 'https://evil.invalid' } })).status).toBe(403);
 });
 it('serves cached Brotli to capable browsers with a gzip fallback',async()=>{const br=await fetch(base,{headers:{'Accept-Encoding':'br, gzip'}});expect(br.headers.get('content-encoding')).toBe('br');expect(await br.text()).toContain('ImiCall');const gzip=await fetch(base,{headers:{'Accept-Encoding':'br;q=0, gzip'}});expect(gzip.headers.get('content-encoding')).toBe('gzip');expect(await gzip.text()).toContain('ImiCall');});
 it('rejects a WebSocket handshake with an untrusted Origin', async()=>{
   const rejected = new WebSocket(`ws://localhost:${port}/ws`, {origin:'https://evil.invalid'});
   await new Promise<void>((resolve,reject)=>{rejected.once('error',()=>resolve());rejected.once('open',()=>{rejected.terminate();reject(new Error('Unexpected origin accepted'));});});
 });
 it('closes malformed nonce messages instead of relaying them', async()=>{
   const a=await socket();let reply=next(a);a.send(JSON.stringify({type:'join',roomId:'line-'+randomBytes(16).toString('hex'),auth:randomBytes(32).toString('hex'),deviceId:randomBytes(16).toString('hex')}));await reply;
   const closed=new Promise(r=>a.once('close',r));a.send(JSON.stringify({type:'candidate',payload:{iv:Array(12).fill(256),data:'YQ=='}}));await closed;
 });
 it('pairs only authenticated room members and rejects duplicate joins and third peers', async () => {
   const roomId = 'line-' + randomBytes(16).toString('hex'), auth = randomBytes(32).toString('hex');
   const join = { type: 'join', roomId, auth, deviceId: randomBytes(16).toString('hex') };
   const a = await socket(); let reply = next(a); a.send(JSON.stringify(join)); expect((await reply).type).toBe('joined');
   const mint = () => fetch(base + '/api/ice', {method:'POST',headers:{Authorization:`Bearer ${auth}`},body:JSON.stringify({roomId,deviceId:join.deviceId})});
   const ice = await mint(); expect(ice.status).toBe(200); expect((await ice.json()).iceServers[0].credential).toBeTruthy(); expect((await mint()).status).toBe(429);
   const bad = await socket(); const closed = new Promise(r => bad.once('close', r)); bad.send(JSON.stringify({ ...join, auth: '0'.repeat(64) })); await closed;
   const b = await socket(); reply = next(b); b.send(JSON.stringify({ ...join, deviceId: randomBytes(16).toString('hex') })); expect((await reply).peersCount).toBe(2);
   const third = await socket(); reply = next(third); third.send(JSON.stringify(join)); expect((await reply).type).toBe('room-full');
   reply = next(b); a.send(JSON.stringify({ type: 'offer', payload: { iv: Array(12).fill(1), data: 'ZW5jcnlwdGVk' } })); expect((await reply).payload.data).toBe('ZW5jcnlwdGVk');
   const duplicateClosed = new Promise(r => a.once('close', r)); a.send(JSON.stringify(join)); await duplicateClosed;
   b.close();
 });
});
