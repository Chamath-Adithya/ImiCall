import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCallAlertPermission } from '../src/core/notificationPermission';
afterEach(() => vi.unstubAllGlobals());
function browser(permission: string, result = 'granted') {
 const requestPermission = vi.fn(() => Promise.resolve(result));
 const Notification = { permission, requestPermission };
 vi.stubGlobal('window', { isSecureContext: true, Notification });
 vi.stubGlobal('Notification', Notification);
 return requestPermission;
}
describe('Notification permission from Enable', () => {
 it('requests immediately on an undecided permission, without needing PushManager first', async () => {
  const request = browser('default'); const pending = requestCallAlertPermission();
  expect(request).toHaveBeenCalledTimes(1); expect(await pending).toBe('granted');
 });
 it('preserves dismissed requests instead of reporting them as blocked', async () => {
  browser('default', 'default'); expect(await requestCallAlertPermission()).toBe('default');
 });
 it('explains browser-blocked permission without pretending to reopen a prompt', async () => {
  const request = browser('denied'); await expect(requestCallAlertPermission()).rejects.toThrow('address-bar site settings'); expect(request).not.toHaveBeenCalled();
 });
 it('does not re-prompt an already allowed user', async () => {
  const request = browser('granted'); expect(await requestCallAlertPermission()).toBe('granted'); expect(request).not.toHaveBeenCalled();
 });
});
