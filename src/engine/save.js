// Browser storage that never throws: private windows and blocked site data
// fall back to an in-memory map for the session. Each mode owns its own keys.
export const LAST_MODE_KEY = 'afterlight.mode';

export function createStorage(backend = globalThis.localStorage) {
  const memory = new Map();
  return {
    getItem(key) { try { return backend.getItem(key); } catch { return memory.get(key) ?? null; } },
    setItem(key, value) { try { backend.setItem(key, value); } catch { memory.set(key, value); throw new Error('Storage unavailable'); } },
    removeItem(key) { try { backend.removeItem(key); } catch { memory.delete(key); } },
  };
}
