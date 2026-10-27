export interface Counts {
  hunks: number;
  lines: number;
  // Files marked with GitHub's own Viewed checkbox.
  files: number;
}

export const ZERO: Counts = { hunks: 0, lines: 0, files: 0 };

export interface Stats {
  days: Record<string, Counts>;
  total: Counts;
}

export interface Summary {
  today: Counts;
  week: Counts;
  month: Counts;
  all: Counts;
}

export const STATS_KEY = 'stats';
// Daily counters older than this are dropped; all-time numbers live in `total`.
const KEEP_DAYS = 31;

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(now: Date, days: number): string {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

const counts = (value: unknown): Counts => {
  const raw = (value ?? {}) as Partial<Counts>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  return { hunks: n(raw.hunks), lines: n(raw.lines), files: n(raw.files) };
};

export function parseStats(value: unknown): Stats {
  const raw = (value ?? {}) as Partial<Stats>;
  const days: Record<string, Counts> = {};
  for (const [day, entry] of Object.entries(raw.days ?? {})) days[day] = counts(entry);
  return { days, total: counts(raw.total) };
}

// Unmarking a hunk subtracts it again, never going below zero.
export function addReview(stats: Stats, delta: Counts, now: Date): Stats {
  const add = (c: Counts): Counts => ({
    hunks: Math.max(0, c.hunks + delta.hunks),
    lines: Math.max(0, c.lines + delta.lines),
    files: Math.max(0, c.files + delta.files),
  });
  const today = dayKey(now);
  const oldest = daysAgo(now, KEEP_DAYS);
  const days: Record<string, Counts> = {};
  for (const [day, entry] of Object.entries(stats.days)) if (day > oldest) days[day] = entry;
  days[today] = add(days[today] ?? ZERO);
  return { days, total: add(stats.total) };
}

// Week and month are rolling windows of 7 and 30 days including today.
export function summarize(stats: Stats, now: Date): Summary {
  const since = (days: number): Counts => {
    const from = daysAgo(now, days - 1);
    const sum = { ...ZERO };
    for (const [day, entry] of Object.entries(stats.days)) {
      if (day >= from) {
        sum.hunks += entry.hunks;
        sum.lines += entry.lines;
        sum.files += entry.files;
      }
    }
    return sum;
  };
  return { today: since(1), week: since(7), month: since(30), all: stats.total };
}

// One entry per calendar day, oldest first, ending today; days without reviews are zero.
export function daily(stats: Stats, now: Date, days = 30): { day: string; counts: Counts }[] {
  return Array.from({ length: days }, (_, i) => {
    const day = daysAgo(now, days - 1 - i);
    return { day, counts: stats.days[day] ?? ZERO };
  });
}

export async function loadStats(): Promise<Stats> {
  return parseStats((await chrome.storage.local.get(STATS_KEY))[STATS_KEY]);
}

let queue: Promise<unknown> = Promise.resolve();

export function recordReview(delta: Counts): Promise<void> {
  const run = queue.then(async () => {
    const stats = await loadStats();
    await chrome.storage.local.set({ [STATS_KEY]: addReview(stats, delta, new Date()) });
  });
  queue = run.catch(() => {});
  return run;
}
