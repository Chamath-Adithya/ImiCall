export const VAPID_PUBLIC_KEY = 'BOuJcOk-mNS1r3WsBBtmDY5wnqKSdPmbcUe-_bv7I8h9ptc3ILFsWJ8iko0iY3qIhQEeIRH0T_wSu1f3Z7_7WsA';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export class PushNotificationManager {
  private static registration: ServiceWorkerRegistration | null = null;

  static async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.info('[Push] Service Workers not supported');
      return null;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[Push] Service Worker registered:', this.registration.scope);
      return this.registration;
    } catch (err) {
      console.warn('[Push] Service Worker registration failed:', err);
      return null;
    }
  }

  static async subscribeToLine(lineId: string): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.info('[Push] Web Push not supported on this browser');
      return false;
    }

    try {
      const reg = this.registration || (await this.registerServiceWorker());
      if (!reg) return false;

      // Check or request notification permission
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        console.warn('[Push] Notification permission not granted');
        return false;
      }

      // Check existing subscription
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
        });
      }

      // Send to signaling server
      const response = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: lineId.trim().toLowerCase(),
          subscription,
        }),
      });

      return response.ok;
    } catch (err: any) {
      console.info('[Push] Background push service unavailable:', err?.message || err);
      return false;
    }
  }
}
