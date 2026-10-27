import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bitbucket, github } from '../src/sites';
import { loadHidden, pruneStale, setViewed, takeViewed, updateHidden } from '../src/storage';

let data: Record<string, unknown>;

beforeEach(() => {
  data = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string | null) => (key === null ? { ...data } : { [key]: data[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(data, structuredClone(items)),
        remove: async (keys: string[]) => {
          for (const key of keys) delete data[key];
        },
      },
    },
  });
});

describe('storage', () => {
  it('keeps hidden hunks and Viewed files side by side', async () => {
    await updateHidden('ghr:o/r#1', ['a', 'b'], []);
    await setViewed('ghr:o/r#1', 'diff-x', { hunks: 2, lines: 5, files: 1 });
    await updateHidden('ghr:o/r#1', [], ['a']);
    expect(await loadHidden('ghr:o/r#1')).toEqual(new Set(['b']));
    expect(await takeViewed('ghr:o/r#1', 'diff-x')).toEqual({ hunks: 2, lines: 5, files: 1 });
    expect(await takeViewed('ghr:o/r#1', 'diff-x')).toBeUndefined();
  });

  it('serializes concurrent updates', async () => {
    await Promise.all([updateHidden('ghr:o/r#1', ['a'], []), updateHidden('ghr:o/r#1', ['b'], [])]);
    expect(await loadHidden('ghr:o/r#1')).toEqual(new Set(['a', 'b']));
  });

  it('prunes PRs untouched for 30 days and leaves other keys alone', async () => {
    const now = Date.now();
    data = {
      'ghr:o/r#1': { keys: [], at: now - 31 * 864e5 },
      'ghr:o/r#2': { keys: [], at: now - 864e5 },
      stats: { days: {}, total: {} },
    };
    await pruneStale(now);
    expect(Object.keys(data).sort()).toEqual(['ghr:o/r#2', 'stats']);
  });
});

describe('Viewed checkboxes', () => {
  it('GitHub: only the Viewed button inside a file, with its state before the click', () => {
    document.body.innerHTML =
      '<div id="diff-x"><button aria-pressed="false"><span>Viewed</span></button><button aria-pressed="true">split</button></div>' +
      '<button aria-pressed="false">Viewed</button>';
    const [inFile, other, outside] = document.querySelectorAll('button');
    expect(github.viewedClick(inFile.querySelector('span'))).toEqual({
      root: document.querySelector('#diff-x'),
      viewing: true,
    });
    expect(github.viewedClick(other)).toBeNull();
    expect(github.viewedClick(outside)).toBeNull();
    expect(github.viewedControl(document.querySelector('#diff-x')!)).toBe(inFile);
  });

  it('Bitbucket: only the checkbox itself counts, once the browser has flipped it', () => {
    document.body.innerHTML =
      '<div data-qa="branch-diff-file" aria-label="Diff of file a.ts"><label><input type="checkbox"><svg></svg><span>Viewed</span></label></div>';
    const root = document.querySelector<HTMLElement>('[data-qa="branch-diff-file"]')!;
    const input = document.querySelector('input')!;
    const seen: unknown[] = [];
    document.addEventListener('click', (event) => seen.push(bitbucket.viewedClick(event.target)), true);
    // A click on the label text fires on the span, then on the checkbox.
    document.querySelector('span')!.click();
    expect(seen).toEqual([null, { root, viewing: true }]);
    expect(bitbucket.viewedControl(root)).toBe(input);
    expect(bitbucket.isChecked(input)).toBe(true);
    expect(bitbucket.fileId(root)).toBe('Diff of file a.ts');
  });
});
