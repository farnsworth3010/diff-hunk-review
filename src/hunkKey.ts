import type { DiffFile } from './dom';

// cyrb53: fast synchronous 53-bit string hash, good enough to tell lines apart.
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// A line's key ignores line numbers, so edits elsewhere in the file keep it; its neighbours
// are hashed in, so the same line moved elsewhere, or edited next to, gets a new one.
// Old-side lines are numbered before new-side ones so the order matches in unified and split views.
export function assignKeys(file: Pick<DiffFile, 'path' | 'hunks'>): void {
  const lines = file.hunks.flatMap((hunk) => hunk.lines);
  const seen = new Map<string, number>();
  for (const side of ['-', '+'] as const) {
    for (const line of lines) {
      if (line.side !== side) continue;
      const hash = cyrb53([side, line.before.join('\n'), line.text, line.after.join('\n')].join('\0'));
      const occurrence = seen.get(hash) ?? 0;
      seen.set(hash, occurrence + 1);
      line.key = `${file.path}\0${hash}#${occurrence}`;
    }
  }
}
