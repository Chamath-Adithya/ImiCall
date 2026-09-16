import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { REQUIRED_PASSCODE, hashPasscode } from '../src/core/types';

beforeAll(() => {
  if (!globalThis.crypto) {
    // @ts-ignore
    globalThis.crypto = webcrypto;
  }
});

describe('Mandatory Passcode (2023) & Ringing Handshake', () => {
  it('should enforce REQUIRED_PASSCODE to be 2023', () => {
    expect(REQUIRED_PASSCODE).toBe('2023');
  });

  it('should generate valid SHA-256 hash for passcode 2023', async () => {
    const hash = await hashPasscode('2023');
    expect(hash).toHaveLength(64); // SHA-256 produces 64 hex characters
    expect(typeof hash).toBe('string');

    // Deterministic verification
    const repeatHash = await hashPasscode('2023');
    expect(repeatHash).toBe(hash);

    // Mismatched PIN produces different hash
    const wrongHash = await hashPasscode('0000');
    expect(wrongHash).not.toBe(hash);
  });
});
