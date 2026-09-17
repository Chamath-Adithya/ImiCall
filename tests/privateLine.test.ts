import { describe, it, expect, beforeAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { PrivateSignaling, newLineId, newLineSecret, lineAuth, isSecureLine } from '../src/core/privateLine';
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
describe('Private invitation and authenticated signaling', () => {
  it('generates independent room IDs and secrets, rejecting shared PINs', () => {
    const id = newLineId(), secret = newLineSecret();
    expect(isSecureLine(id, secret)).toBe(true);
    expect(isSecureLine(id, '2023')).toBe(false);
    expect(newLineSecret()).not.toBe(secret);
    expect(newLineId()).not.toBe(id);
  });
  it('authenticates message type, room, secret and rejects replay', async () => {
    const id = newLineId(), secret = newLineSecret();
    const a = new PrivateSignaling(id), b = new PrivateSignaling(id), wrong = new PrivateSignaling(id);
    await Promise.all([a.init(secret), b.init(secret), wrong.init(newLineSecret())]);
    const packet = await a.seal('offer', { sdp: 'private-fingerprint' });
    expect(JSON.stringify(packet)).not.toContain('private-fingerprint');
    await expect(wrong.open('offer', packet)).rejects.toThrow();
    await expect(b.open('answer', packet)).rejects.toThrow();
    expect(await b.open('offer', packet)).toEqual({ sdp: 'private-fingerprint' });
    await expect(b.open('offer', packet)).rejects.toThrow(/replay/);
    expect(await lineAuth(id, secret)).not.toBe(secret);
    await expect(a.open('offer', packet)).rejects.toThrow();
  });
  it('rejects tampering and stale messages', async () => {
    const id = newLineId(), secret = newLineSecret(), a = new PrivateSignaling(id), b = new PrivateSignaling(id);
    await Promise.all([a.init(secret), b.init(secret)]);
    const packet = await a.seal('call-ring');
    const invalid = {...packet, iv: [...packet.iv]}; invalid.iv[0] += 256;
    await expect(b.open('call-ring', invalid)).rejects.toThrow('Invalid encrypted signal');
    packet.iv[0] ^= 1;
    await expect(b.open('call-ring', packet)).rejects.toThrow();
    const fresh = await a.seal('call-ring');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121000);
    try { await expect(b.open('call-ring', fresh)).rejects.toThrow(/Expired/); } finally { clock.mockRestore(); }
  });
});
