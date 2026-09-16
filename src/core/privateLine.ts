/** A link is a bearer credential. Its secret stays in the URL fragment/browser. */
export const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
export const newLineId = () => `line-${randomHex(16)}`;
export const newLineSecret = () => randomHex(32);
export const isSecureLine = (id: string, secret: string) => /^line-[a-f0-9]{32}$/.test(id) && /^[a-f0-9]{64}$/.test(secret);
const encoder = new TextEncoder();
export async function lineAuth(id: string, secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`imicall:join:v2:${id}:${secret}`));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** Authenticated encryption protects SDP fingerprints and call control from the relay. */
export class PrivateSignaling {
  private key!: CryptoKey;
  private sender = randomHex(16);
  private sequence = 0;
  private received = new Map<string, number>();
  constructor(private room: string) {}
  async init(secret: string) {
    if (!isSecureLine(this.room, secret)) throw new Error('This older link needs an upgrade. Create and share a new private connection.');
    const material = await crypto.subtle.digest('SHA-256', encoder.encode(`imicall:signals:v2:${this.room}:${secret}`));
    this.key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async seal(type: string, payload: unknown = null) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = encoder.encode(JSON.stringify({ sender: this.sender, sequence: ++this.sequence, time: Date.now(), payload }));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${this.room}:${type}`) }, this.key, data);
    return { iv: Array.from(iv), data: btoa(String.fromCharCode(...new Uint8Array(encrypted))) };
  }
  async open(type: string, envelope: any): Promise<any> {
    if (!Array.isArray(envelope?.iv) || envelope.iv.length !== 12 || typeof envelope.data !== 'string' || envelope.data.length > 100000) throw new Error('Invalid encrypted signal');
    const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(envelope.iv), additionalData: encoder.encode(`${this.room}:${type}`) }, this.key, Uint8Array.from(atob(envelope.data), c => c.charCodeAt(0)));
    const message = JSON.parse(new TextDecoder().decode(decoded));
    if (typeof message.sender !== 'string' || !/^[a-f0-9]{32}$/.test(message.sender) || message.sender === this.sender || !Number.isSafeInteger(message.sequence) || !Number.isFinite(message.time) || Math.abs(Date.now() - message.time) > 120000 || message.sequence <= (this.received.get(message.sender) || 0)) throw new Error('Expired or replayed signal');
    if (!this.received.has(message.sender) && this.received.size >= 100) throw new Error('Too many peer sessions; reopen this connection');
    this.received.set(message.sender, message.sequence);
    return message.payload;
  }
}
