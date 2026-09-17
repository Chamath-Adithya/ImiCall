let temporary = false;
try { temporary = new URLSearchParams(location.search).get('temporary') === '1' || sessionStorage.getItem('imicall_temporary') === '1'; if (temporary) sessionStorage.setItem('imicall_temporary', '1'); } catch {}
let unavailable = false;
const memory = new Map<string, string>();
export const localStore = {
  getItem(key: string): string | null { if (temporary) return memory.get(key) ?? null; try { return localStorage.getItem(key); } catch { unavailable = true; return memory.get(key) ?? null; } },
  setItem(key: string, value: string) { memory.set(key, value); if (temporary) return; try { localStorage.setItem(key, value); } catch { unavailable = true; } },
  removeItem(key: string) { memory.delete(key); if (temporary) return; try { localStorage.removeItem(key); } catch { unavailable = true; } },
  clearImiCall() { memory.clear(); if (temporary) return; try { for (const key of Object.keys(localStorage)) if (key.startsWith('imicall_')) localStorage.removeItem(key); } catch { unavailable = true; } },
  isTemporary: () => temporary,
  isUnavailable: () => unavailable,
};
