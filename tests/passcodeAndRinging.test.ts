import { it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { PrivateSignaling, newLineId, newLineSecret, lineAuth } from '../src/core/privateLine';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
it('does not allow the relay join token to decrypt call setup', async () => {
 const id = newLineId(), secret = newLineSecret(), sender = new PrivateSignaling(id), relay = new PrivateSignaling(id);
 await sender.init(secret); await relay.init(await lineAuth(id, secret));
 await expect(relay.open('offer', await sender.seal('offer', { sdp: 'fingerprint' }))).rejects.toThrow();
});
