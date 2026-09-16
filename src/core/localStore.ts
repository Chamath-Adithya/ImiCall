let unavailable = false;
const memory = new Map<string, string>();
export const localStore = {
  getItem(key: string): string | null { try { return localStorage.getItem(key); } catch { unavailable = true; return memory.get(key) ?? null; } },
  setItem(key: string, value: string) { memory.set(key, value); try { localStorage.setItem(key, value); } catch { unavailable = true; } },
  removeItem(key: string) { memory.delete(key); try { localStorage.removeItem(key); } catch { unavailable = true; } },
  isUnavailable: () => unavailable,
};
