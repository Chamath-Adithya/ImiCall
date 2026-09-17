import type { SavedLine } from '../App';
const encode = (a: Uint8Array) => btoa(Array.from(a, b => String.fromCharCode(b)).join(''));
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export function validateConnections(input: unknown): SavedLine[] {
 if (!Array.isArray(input) || input.length > 100) throw new Error('Backup must contain at most 100 connections.');
 const ids = new Set<string>();
 return input.map(value => {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{3,80}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.passcode !== 'string' || value.passcode.length > 128 || !value.passcode.length || ids.has(value.id)) throw new Error('Invalid or duplicate connection in backup.');
  ids.add(value.id);
  return { id: value.id, name: value.name.trim(), passcode: value.passcode, createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(), ...(typeof value.myDisplayName === 'string' ? { myDisplayName: value.myDisplayName.slice(0,80) } : {}) };
 });
}
async function keyFor(password: string, salt: Uint8Array, usage: KeyUsage[]) {
 if (!crypto.subtle) throw new Error('Encrypted backups require HTTPS.');
 const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
 return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: new Uint8Array(salt) }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}
export async function exportConnections(lines: SavedLine[], password: string) {
 if (password.length < 12) throw new Error('Use a backup password with at least 12 characters.');
 const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
 const key = await keyFor(password, salt, ['encrypt']);
 const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('imicall-backup-v1') }, key, new TextEncoder().encode(JSON.stringify(validateConnections(lines))));
 return JSON.stringify({ format: 'imicall-backup', version: 1, rounds: 310000, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)) });
}
export async function importConnections(text: string, password: string) {
 if (text.length > 2000000) throw new Error('Backup is too large.');
 const v = JSON.parse(text);
 if (v.format !== 'imicall-backup' || v.version !== 1 || v.rounds !== 310000 || typeof v.salt !== 'string' || typeof v.iv !== 'string' || typeof v.data !== 'string') throw new Error('Unsupported backup format.');
 const salt = decode(v.salt), iv = decode(v.iv);
 if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid backup.');
 try {
  const key = await keyFor(password, salt, ['decrypt']);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('imicall-backup-v1') }, key, decode(v.data));
  return validateConnections(JSON.parse(new TextDecoder().decode(bytes)));
 } catch { throw new Error('Wrong password or damaged backup. No contacts were changed.'); }
}
export function downloadFile(name: string, text: string) {
 const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob);
 const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
