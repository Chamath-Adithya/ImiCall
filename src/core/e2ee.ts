/**
 * Zero-Trust End-to-End Encryption (E2EE) for WebRTC Audio Frames.
 * Uses WebRTC Insertable Streams (createEncodedStreams) and AES-GCM (Web Crypto API).
 * Ensures zero-trust security: even the signaling server and network relay cannot decrypt audio.
 */

const MAGIC_BYTE = 0x69; // 'i' for ImiCall
const IV_LENGTH = 12;

function getCrypto(): Crypto {
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto) {
    return (globalThis as any).crypto;
  }
  throw new Error('Web Crypto API not available');
}

export class AudioE2EE {
  private key: CryptoKey | null = null;
  private isEnabled: boolean = false;
  private frameCounter: number = 0;

  /**
   * Derives an AES-GCM 128-bit key from a user passphrase using SHA-256.
   */
  async setPassphrase(passphrase: string): Promise<void> {
    if (!passphrase || passphrase.trim().length === 0) {
      this.key = null;
      this.isEnabled = false;
      return;
    }

    const cryptoApi = getCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(passphrase);
    const hash = await cryptoApi.subtle.digest('SHA-256', data);

    this.key = await cryptoApi.subtle.importKey(
      'raw',
      hash.slice(0, 16), // 128-bit key for fast real-time audio on mobile CPU
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    this.isEnabled = true;
  }

  isEncryptionActive(): boolean {
    return this.isEnabled && this.key !== null;
  }

  /**
   * Sets up sender transform to encrypt outgoing audio frames.
   */
  setupSenderTransform(sender: RTCRtpSender): boolean {
    try {
      // Check standard createEncodedStreams
      // @ts-ignore - createEncodedStreams is in modern browsers
      if (typeof sender.createEncodedStreams === 'function') {
        // @ts-ignore
        const senderStreams = sender.createEncodedStreams();
        const readableStream = senderStreams.readable;
        const writableStream = senderStreams.writable;

        const transformStream = new TransformStream({
          transform: async (encodedFrame, controller) => {
            if (!this.isEnabled || !this.key) {
              controller.enqueue(encodedFrame);
              return;
            }

            try {
              const encryptedData = await this.encryptFrame(encodedFrame.data);
              encodedFrame.data = encryptedData;
              controller.enqueue(encodedFrame);
            } catch (err) {
              console.warn('[E2EE] Frame encryption failed; discarded frame.');
            }
          },
        });

        readableStream.pipeThrough(transformStream).pipeTo(writableStream);
        return true;
      }
    } catch (e) {
      console.warn('[E2EE] Sender Insertable Streams not supported:', e);
    }
    return false;
  }

  /**
   * Sets up receiver transform to decrypt incoming audio frames.
   */
  setupReceiverTransform(receiver: RTCRtpReceiver): boolean {
    try {
      // @ts-ignore
      if (typeof receiver.createEncodedStreams === 'function') {
        // @ts-ignore
        const receiverStreams = receiver.createEncodedStreams();
        const readableStream = receiverStreams.readable;
        const writableStream = receiverStreams.writable;

        const transformStream = new TransformStream({
          transform: async (encodedFrame, controller) => {
            if (!this.isEnabled || !this.key) {
              controller.enqueue(encodedFrame);
              return;
            }

            try {
              const decryptedData = await this.decryptFrame(encodedFrame.data);
              if (decryptedData) {
                encodedFrame.data = decryptedData;
                controller.enqueue(encodedFrame);
              }
            } catch (err) {
              // Decryption error (e.g. key mismatch) -> discard frame to avoid noise
            }
          },
        });

        readableStream.pipeThrough(transformStream).pipeTo(writableStream);
        return true;
      }
    } catch (e) {
      console.warn('[E2EE] Receiver Insertable Streams not supported:', e);
    }
    return false;
  }

  /**
   * Encrypts a frame buffer with AES-GCM:
   * [1 byte MAGIC] [12 bytes IV] [AES-GCM Ciphertext + 16 bytes Tag]
   */
  async encryptFrame(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    if (!this.key) return buffer;

    const cryptoApi = getCrypto();
    const iv = new Uint8Array(IV_LENGTH);
    this.frameCounter = (this.frameCounter + 1) & 0xffffffff;
    // Set 4 bytes counter, random 8 bytes
    cryptoApi.getRandomValues(iv);
    new DataView(iv.buffer).setUint32(0, this.frameCounter, false);

    const ciphertext = await cryptoApi.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      this.key,
      buffer
    );

    const output = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength);
    output[0] = MAGIC_BYTE;
    output.set(iv, 1);
    output.set(new Uint8Array(ciphertext), 1 + IV_LENGTH);

    return output.buffer;
  }

  /**
   * Decrypts a frame buffer. Returns null if invalid or corrupted.
   */
  async decryptFrame(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
    if (!this.key) return buffer;

    const input = new Uint8Array(buffer);
    if (input.length < 1 + IV_LENGTH + 16) {
      return null;
    }

    // Check magic byte
    if (input[0] !== MAGIC_BYTE) {
      // Frame was not encrypted with our schema, pass through or discard
      return null;
    }

    const cryptoApi = getCrypto();
    const iv = input.slice(1, 1 + IV_LENGTH);
    const ciphertext = input.slice(1 + IV_LENGTH);

    try {
      const decrypted = await cryptoApi.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        this.key,
        ciphertext
      );
      return decrypted;
    } catch (e) {
      // Key mismatch or tag auth failure
      return null;
    }
  }
}
