interface RuntimeConfig { publicUrl?: string; vapidPublicKey?: string; iceServers?: RTCIceServer[]; }
let cached: Promise<RuntimeConfig> | null = null;
let cachedAt = 0;
export function runtimeConfig(): Promise<RuntimeConfig> {
  if (!cached || Date.now() - cachedAt > 300000) {
    cachedAt = Date.now();
    cached = fetch('/api/config', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('Configuration unavailable'); return r.json(); }).catch(error => { cached = null; throw error; });
  }
  return cached;
}
