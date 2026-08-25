import AsyncStorage from '@react-native-async-storage/async-storage';

const memoryCache = new Map();
const MEMORY_CACHE_MAX_ENTRIES = 200;

function evictOldestIfNeeded() {
  while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
}

export function withTimeout(promise, timeoutMs = 10000, message = 'The request took too long. Please try again.') {
  let timeoutId;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

export function peekCachedData(key) {
  return memoryCache.get(key)?.data ?? null;
}

export async function readCachedData(key, { maxAgeMs = Infinity } = {}) {
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && Date.now() - memoryEntry.savedAt <= maxAgeMs) return memoryEntry.data;

  const stored = await AsyncStorage.getItem(key).catch(() => null);
  if (!stored) return null;
  try {
    const entry = JSON.parse(stored);
    if (!entry || !Number.isFinite(entry.savedAt) || Date.now() - entry.savedAt > maxAgeMs) return null;
    memoryCache.set(key, entry);
    evictOldestIfNeeded();
    return entry.data;
  } catch {
    return null;
  }
}

export async function writeCachedData(key, data) {
  const entry = { savedAt: Date.now(), data };
  memoryCache.set(key, entry);
  evictOldestIfNeeded();
  await AsyncStorage.setItem(key, JSON.stringify(entry)).catch(() => {});
  return data;
}
