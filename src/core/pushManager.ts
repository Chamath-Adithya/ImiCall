import { runtimeConfig } from './runtimeConfig';
import { localStore } from './localStore';
import { lineAuth, randomHex } from './privateLine';
const DEVICE_KEY = 'imicall_device_v2';
export function deviceId() {
  let id = localStore.getItem(DEVICE_KEY);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) { id = randomHex(16); localStore.setItem(DEVICE_KEY, id); }
  return id;
}
export class PushNotificationManager {
  private static registration: ServiceWorkerRegistration | null = null;
  static async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try { await navigator.serviceWorker.register('/sw.js'); this.registration = await navigator.serviceWorker.ready; return this.registration; } catch { return null; }
  }
  static async subscribeToLine(roomId: string, secret: string): Promise<boolean> {
    if (!('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return false;
    try {
      const reg = this.registration || await this.registerServiceWorker();
      if (!reg) return false;
      const { vapidPublicKey } = await runtimeConfig();
      if (!vapidPublicKey) return false;
      const key = Uint8Array.from(atob(vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      let subscription = await reg.pushManager.getSubscription();
      if (subscription?.options.applicationServerKey && Array.from(new Uint8Array(subscription.options.applicationServerKey)).join() !== Array.from(key).join()) { await subscription.unsubscribe(); subscription = null; }
      subscription ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      return (await fetch('/api/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await lineAuth(roomId, secret)}` }, body: JSON.stringify({ roomId, subscription, deviceId: deviceId() }) })).ok;
    } catch { return false; }
  }
  static async unsubscribeFromLine(roomId: string, secret: string) {
    try { await fetch('/api/push-unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await lineAuth(roomId, secret)}` }, body: JSON.stringify({ roomId, deviceId: deviceId() }) }); } catch { /* Memory entries expire within 24 hours. */ }
  }
  static async disable(lines: { id: string; passcode: string }[]) {
    await Promise.all(lines.map(line => this.unsubscribeFromLine(line.id, line.passcode)));
    const reg = this.registration || await this.registerServiceWorker();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  }
}
