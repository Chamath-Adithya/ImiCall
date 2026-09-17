/** Call directly from the Enable click, before any network or worker awaits. */
export function requestCallAlertPermission(): Promise<NotificationPermission> {
  if (!window.isSecureContext) return Promise.reject(new Error('Open ImiCall over HTTPS to enable notifications.'));
  if (!('Notification' in window)) return Promise.reject(new Error('This browser cannot request notifications. Open ImiCall in Chrome/Safari. On iPhone or iPad, add it to the Home Screen and open it there.'));
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.reject(new Error('Notifications are blocked for this site. Open the address-bar site settings → Notifications → Allow, then click Enable again. A website cannot reopen a prompt after the browser blocks it. If this is an in-app preview, open the link in your regular browser.'));
  return Notification.requestPermission();
}
