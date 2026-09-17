interface RuntimeConfig { publicUrl?: string; vapidPublicKey?: string; relayConfigured?: boolean; }
let cached: Promise<RuntimeConfig> | null = null;
let cachedAt = 0;
export function runtimeConfig(): Promise<RuntimeConfig> {
  if (!cached || Date.now() - cachedAt > 300000) {
    cachedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    cached = fetch('/api/config', { cache: 'no-store', signal: controller.signal }).then(r => { if (!r.ok) throw new Error('Configuration unavailable'); return r.json(); }).catch(error => { cached = null; throw error; }).finally(() => clearTimeout(timeout));
  }
  return cached;
}
