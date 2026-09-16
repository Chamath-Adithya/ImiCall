import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { AudioE2EE } from '../src/core/e2ee';

beforeAll(() => {
  if (!globalThis.crypto) {
    // @ts-ignore
    globalThis.crypto = webcrypto;
  }
});

describe('WebRTC E2EE Audio Frame Encryption', () => {
  it('should encrypt and decrypt an audio frame with identical secret passphrase', async () => {
    const senderE2ee = new AudioE2EE();
    const receiverE2ee = new AudioE2EE();

    const passphrase = 'ultra-secure-rural-calling-password-123';
    await senderE2ee.setPassphrase(passphrase);
    await receiverE2ee.setPassphrase(passphrase);

    expect(senderE2ee.isEncryptionActive()).toBe(true);
    expect(receiverE2ee.isEncryptionActive()).toBe(true);

    // Mock an Opus audio frame (e.g. 80 bytes audio packet)
    const rawAudio = new Uint8Array([0xf8, 0xff, 0xfe, 0x01, 0x42, 0x88, 0x99, 0xaa, 0xbb, 0xcc]);
    const encryptedBuffer = await senderE2ee.encryptFrame(rawAudio.buffer);

    // Verify it is not identical to plaintext
    expect(new Uint8Array(encryptedBuffer)).not.toEqual(rawAudio);

    // Verify magic byte
    const encryptedArray = new Uint8Array(encryptedBuffer);
    expect(encryptedArray[0]).toBe(0x69); // 'i'

    // Decrypt on receiver side
    const decryptedBuffer = await receiverE2ee.decryptFrame(encryptedBuffer);
    expect(decryptedBuffer).not.toBeNull();
    expect(new Uint8Array(decryptedBuffer!)).toEqual(rawAudio);
  });

  it('should reject decryption when passphrase is wrong', async () => {
    const senderE2ee = new AudioE2EE();
    const attackerE2ee = new AudioE2EE();

    await senderE2ee.setPassphrase('correct-password');
    await attackerE2ee.setPassphrase('wrong-hacker-password');

    const rawAudio = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encryptedBuffer = await senderE2ee.encryptFrame(rawAudio.buffer);

    const decryptedBuffer = await attackerE2ee.decryptFrame(encryptedBuffer);
    expect(decryptedBuffer).toBeNull();
  });
});
