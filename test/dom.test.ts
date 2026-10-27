import { beforeEach, describe, expect, it } from 'vitest';
import { parseFile } from '../src/dom';
import { applyFile, buttonKeys, toggleLines, unreviewed } from '../src/review';
import { github } from '../src/sites';
import { code, type Line, renderFile, sample } from './fixture';

// Row indexes in `sample`: 0 @@, 1 a, 2 -old, 3 +new, 4 comment, 5 b, 6 +added, 7 c, 8 @@, 9 d, 10 -gone, 11 e.
const keysOf = (lines: Line[]) =>
  parseFile(renderFile(lines))!
    .hunks.flatMap((hunk) => hunk.lines)
    .map((line) => line.key);
const rowsOf = (table: HTMLTableElement) => [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')];
const buttonAt = (table: HTMLTableElement, row: number) =>
  rowsOf(table)[row].querySelector<HTMLButtonElement>('.ghr-toggle')!;
const flags = (table: HTMLTableElement) =>
  rowsOf(table)
    .map((r) => (r.hasAttribute('data-ghr-collapsed') ? 'C' : r.hasAttribute('data-ghr-hidden') ? 'H' : '.'))
    .join('');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('parseFile', () => {
  it('splits changes into hunks of consecutive changed lines', () => {
    const table = renderFile(sample);
    const rows = rowsOf(table);
    const file = parseFile(table)!;
    expect(file.path).toBe('src/a.ts');
    expect(file.root.id).toBe('diff-abc');
    expect(file.hunks.map((h) => h.lines.map((l) => `${l.side}${l.text}`))).toEqual([
      ['-old', '+new'],
      ['+added'],
      ['-gone'],
    ]);
    expect(file.hunks[0].head).toBe(rows[2]);
    expect(file.hunks[0].rows).toEqual([rows[2], rows[3], rows[4]]);
  });

  it('links each line to its neighbours on the same side, within an "@@" section', () => {
    const lines = parseFile(renderFile(sample))!.hunks.flatMap((h) => h.lines);
    expect(lines.map(({ before, after }) => [before, after])).toEqual([
      [['a'], ['b', 'c']],
      [['a'], ['b', 'added']],
      [['new', 'b'], ['c']],
      [['d'], ['e']],
    ]);
  });

  it('does not include the trailing expand row in a hunk that ends the file', () => {
    const [hunk] = parseFile(
      renderFile([
        ['@@', '@@ -1 +1 @@'],
        [' ', 'a'],
        ['+', 'last'],
      ]),
    )!.hunks;
    expect(hunk.rows).toHaveLength(1);
  });
});

describe('line keys', () => {
  it('ignore line numbers', () => {
    const shifted = sample.map(
      ([kind, text]): Line => (kind === '@@' ? ['@@', text.replace(/\d+/g, '9')] : [kind, text]),
    );
    expect(keysOf(shifted)).toEqual(keysOf(sample));
  });

  it('change for an edited line and its neighbours only', () => {
    const before = keysOf(sample);
    const after = keysOf(sample.map(([k, t]): Line => [k, t === 'added' ? 'added!' : t]));
    // -old, +new (neighbour of "added"), +added change; -gone in the other section keeps its key.
    expect(after.map((key, i) => key === before[i])).toEqual([true, false, false, true]);
  });

  it('do not let the same line in a new place take over a reviewed one', () => {
    const block: Line[] = [
      [' ', 'x'],
      ['+', 'return true;'],
      [' ', 'y'],
    ];
    const [reviewed] = keysOf([['@@', '@@ -1 +1 @@'], ...block]);
    const keys = keysOf([
      ['@@', '@@ -1 +1 @@'],
      [' ', 'p'],
      ['+', 'return true;'],
      [' ', 'q'],
      ['@@', '@@ -9 +9 @@'],
      ...block,
    ]);
    expect(keys[0]).not.toBe(reviewed);
    expect(keys[1]).toBe(reviewed);
  });

  it('number fully identical lines', () => {
    const keys = keysOf([
      ['@@', '@@ -1 +1 @@'],
      [' ', 'x'],
      ['+', 'y'],
      [' ', 'x'],
      ['+', 'y'],
      [' ', 'x'],
      ['+', 'y'],
      [' ', 'x'],
      ['+', 'y'],
      [' ', 'x'],
    ]);
    expect(new Set(keys).size).toBe(4);
  });

  it('are the same in unified and split views', () => {
    const unified = keysOf([
      ['@@', '@@ -1,2 +1,2 @@'],
      ['-', 'a'],
      ['-', 'b'],
      ['+', 'c'],
      ['+', 'd'],
    ]);
    const table = renderFile([['@@', '@@ -1,2 +1,2 @@']]);
    table
      .querySelector('tr')!
      .insertAdjacentHTML(
        'afterend',
        `<tr>${code('deletion', 'a')}${code('addition', 'c')}</tr><tr>${code('deletion', 'b')}${code('addition', 'd')}</tr>`,
      );
    const split = parseFile(table)!.hunks.flatMap((h) => h.lines);
    expect(split.map((line) => line.key).sort()).toEqual([...unified].sort());
  });
});

describe('review', () => {
  it('puts a button on the first changed row of each hunk, not on "@@" rows', () => {
    const table = renderFile(sample);
    applyFile(table, new Set());
    const rows = rowsOf(table);
    expect(rows.flatMap((row, i) => (row.querySelector('.ghr-toggle') ? [i] : []))).toEqual([2, 6, 10]);
    expect(buttonAt(table, 2).parentElement).toBe(rows[2].cells[0]);
  });

  it('collapses a whole hunk and brings it back, idempotently', () => {
    const table = renderFile(sample);
    const hidden = new Set<string>();
    applyFile(table, hidden);
    const result = toggleLines(table, buttonKeys(buttonAt(table, 2)), 'hide', hidden);
    expect(result.changed).toHaveLength(2);
    expect(result.hunks).toBe(1);
    expect(flags(table)).toBe('..CHH........');
    expect(buttonAt(table, 2).dataset.ghrAction).toBe('show');
    expect(buttonAt(table, 2).querySelector('.ghr-label')!.textContent).toBe('Reviewed −1 +1 · show');
    expect(document.querySelector('.ghr-progress')!.textContent).toBe('1/3 hunks');

    const html = document.body.innerHTML;
    applyFile(table, hidden);
    expect(document.body.innerHTML).toBe(html);

    expect(toggleLines(table, buttonKeys(buttonAt(table, 2)), 'show', hidden).hunks).toBe(-1);
    expect(flags(table)).toBe('.............');
  });

  it('collapses single lines inside a hunk and keeps a button for the rest', () => {
    const table = renderFile(sample);
    const hidden = new Set<string>();
    applyFile(table, hidden);
    const [, newLine] = parseFile(table)!.hunks[0].lines;
    const result = toggleLines(table, [newLine.key], 'hide', hidden);
    expect(result.hunks).toBe(0);
    // "+new" collapses together with the comment row under it; "-old" stays with the hunk's button.
    expect(flags(table)).toBe('...CH........');
    expect(buttonAt(table, 3).querySelector('.ghr-label')!.textContent).toBe('Reviewed +1 · show');
    const rest = buttonAt(table, 2);
    expect(buttonKeys(rest)).toHaveLength(1);
    expect(rest.title).toBe('Hide the 1 remaining lines of this hunk');
    expect(unreviewed(table, hidden)).toEqual({ hunks: 3, lines: 3 });

    expect(toggleLines(table, buttonKeys(rest), 'hide', hidden).hunks).toBe(1);
    expect(flags(table)).toBe('..CHH........');
    expect(unreviewed(table, hidden)).toEqual({ hunks: 2, lines: 2 });
  });
});

describe('GitHub PR key', () => {
  it('matches PR diff pages only', () => {
    expect(github.prKey('/NodeJS/node/pull/50000/changes')).toBe('ghr:nodejs/node#50000');
    expect(github.prKey('/nodejs/node/pull/50000/files')).toBe('ghr:nodejs/node#50000');
    expect(github.prKey('/nodejs/node/pull/50000/changes/abc..def')).toBe('ghr:nodejs/node#50000');
    expect(github.prKey('/nodejs/node/pull/50000')).toBeNull();
  });
});
