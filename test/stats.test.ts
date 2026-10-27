import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings';
import { addReview, daily, dayKey, parseStats, type Stats, summarize } from '../src/stats';

const at = (day: string) => new Date(`${day}T12:00:00`);
const empty: Stats = { days: {}, total: { hunks: 0, lines: 0, files: 0 } };
const c = (hunks: number, lines: number, files = 0) => ({ hunks, lines, files });

describe('stats', () => {
  it('counts today, rolling 7 and 30 days, and all time', () => {
    let stats = empty;
    stats = addReview(stats, c(1, 10), at('2026-09-01'));
    stats = addReview(stats, c(2, 5), at('2026-10-10'));
    stats = addReview(stats, c(1, 3), at('2026-10-20'));
    stats = addReview(stats, c(4, 7), at('2026-10-22'));
    stats = addReview(stats, c(0, 0, 2), at('2026-10-21'));

    expect(summarize(stats, at('2026-10-22'))).toEqual({
      today: c(4, 7),
      week: c(5, 10, 2),
      month: c(7, 15, 2),
      all: c(8, 25, 2),
    });
  });

  it('subtracts unmarked hunks without going below zero', () => {
    let stats = addReview(empty, c(1, 4), at('2026-10-22'));
    stats = addReview(stats, c(-1, -4), at('2026-10-22'));
    stats = addReview(stats, c(-1, -4), at('2026-10-22'));
    expect(summarize(stats, at('2026-10-22')).today).toEqual(c(0, 0));
    expect(stats.total).toEqual(c(0, 0));
  });

  it('drops daily counters older than a month but keeps them in the total', () => {
    let stats = addReview(empty, c(3, 3), at('2026-08-01'));
    stats = addReview(stats, c(1, 1), at('2026-10-22'));
    expect(Object.keys(stats.days)).toEqual(['2026-10-22']);
    expect(stats.total).toEqual(c(4, 4));
  });

  it('lists the last 30 days oldest first, with zeros for days without reviews', () => {
    const stats = addReview(empty, c(2, 9, 1), at('2026-10-20'));
    const days = daily(stats, at('2026-10-22'));
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe('2026-09-23');
    expect(days[29]).toEqual({ day: '2026-10-22', counts: c(0, 0, 0) });
    expect(days[27]).toEqual({ day: '2026-10-20', counts: c(2, 9, 1) });
  });

  it('uses local calendar days', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('tolerates malformed stored data', () => {
    expect(parseStats({ days: { '2026-10-22': { hunks: 'x', lines: -2, files: 1 } }, total: null })).toEqual({
      days: { '2026-10-22': c(0, 0, 1) },
      total: c(0, 0),
    });
    expect(parseStats(undefined)).toEqual(empty);
  });
});

describe('settings', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ enabled: 'no', position: 'top' })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ enabled: false, position: 'right' })).toEqual({
      enabled: false,
      position: 'right',
      autoViewed: true,
    });
    expect(parseSettings({ autoViewed: false }).autoViewed).toBe(false);
  });
});
