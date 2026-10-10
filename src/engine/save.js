// Browser storage for modes. Private windows, blocked site data and a full
// store fall back to an in-memory map for the session: reads never throw, and
// a write that could not persist keeps its value in memory and then throws, so
// the mode can warn that progress lasts only for this session. Each mode owns
// its own keys.
export const LAST_MODE_KEY = 'afterlight.mode';

export function createStorage(backend) {
  const memory = new Map();
  // Reading `localStorage` itself throws when site data is blocked.
  const store = () => backend ?? globalThis.localStorage;
  return {
    getItem(key) { try { return store().getItem(key); } catch { return memory.get(key) ?? null; } },
    setItem(key, value) { try { store().setItem(key, value); } catch { memory.set(key, value); throw new Error('Storage unavailable'); } },
    removeItem(key) { try { store().removeItem(key); } catch { memory.delete(key); } },
  };
}
