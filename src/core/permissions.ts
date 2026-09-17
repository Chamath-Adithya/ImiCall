export function microphoneError(error?: unknown): string {
 if (!window.isSecureContext) return 'Microphone blocked: open ImiCall using a trusted HTTPS address. A phone cannot use microphone access on an http:// local-network IP address.';
 if (!navigator.mediaDevices?.getUserMedia) return 'Microphone unavailable in this browser. Open the link directly in Safari or Chrome, outside an in-app browser.';
 const name = error instanceof Error ? error.name : '';
 if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission is blocked. Allow microphone access for this site in Safari/Chrome settings and for the browser in your phone’s system settings. Then return and try again.';
 if (name === 'NotFoundError') return 'No microphone found. Connect or enable a microphone, then try again.';
 if (name === 'NotReadableError' || name === 'AbortError') return 'Microphone is busy or unavailable. Close other apps using it, check Bluetooth, then try again.';
 return 'Microphone could not start. Open the link directly in Safari or Chrome over HTTPS and retry.';
}
