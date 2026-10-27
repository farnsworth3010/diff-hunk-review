import type { Counts } from './stats';

const PREFIX = 'ghr:';
const DAY = 24 * 60 * 60 * 1000;
// PRs untouched for this long are dropped from storage.
const TTL = 30 * DAY;

interface Stored {
  keys: string[];
  at: number;
  // What each file added to the statistics when it was marked Viewed, by file anchor id.
  viewed: Record<string, Counts>;
}

function parseEntry(value: unknown): Stored {
  const raw = (value ?? {}) as Partial<Stored>;
  return {
    keys: Array.isArray(raw.keys) ? raw.keys.filter((key) => typeof key === 'string') : [],
    at: typeof raw.at === 'number' ? raw.at : 0,
    viewed: raw.viewed && typeof raw.viewed === 'object' ? { ...raw.viewed } : {},
  };
}

export function parseStored(value: unknown): Set<string> {
  return new Set(parseEntry(value).keys);
}

let queue: Promise<unknown> = Promise.resolve();

// Read-modify-write so other tabs' changes to the same PR are kept; serialized within this tab.
function modify<T>(key: string, change: (entry: Stored) => T): Promise<T> {
  const run = queue.then(async () => {
    const entry = parseEntry((await chrome.storage.local.get(key))[key]);
    const result = change(entry);
    await chrome.storage.local.set({ [key]: { ...entry, at: Date.now() } satisfies Stored });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export async function loadHidden(key: string): Promise<Set<string>> {
  const value = (await chrome.storage.local.get(key))[key];
  const entry = parseEntry(value);
  // Touch the entry at most once a day so PRs under review don't expire.
  if (value && Date.now() - entry.at > DAY) await modify(key, () => {});
  return new Set(entry.keys);
}

export function updateHidden(key: string, add: string[], remove: string[]): Promise<void> {
  return modify(key, (entry) => {
    const hidden = new Set(entry.keys);
    for (const k of add) hidden.add(k);
    for (const k of remove) hidden.delete(k);
    entry.keys = [...hidden];
  });
}

export function setViewed(key: string, anchor: string, counts: Counts): Promise<void> {
  return modify(key, (entry) => {
    entry.viewed[anchor] = counts;
  });
}

// Removes and returns what the file added when it was marked Viewed.
export function takeViewed(key: string, anchor: string): Promise<Counts | undefined> {
  return modify(key, (entry) => {
    const counts = entry.viewed[anchor];
    delete entry.viewed[anchor];
    return counts;
  });
}

export async function pruneStale(now = Date.now()): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all)
    .filter(([key, value]) => key.startsWith(PREFIX) && !(now - parseEntry(value).at < TTL))
    .map(([key]) => key);
  if (stale.length) await chrome.storage.local.remove(stale);
}
