import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/controller';
import { parseFile } from '../src/dom';
import { applyFile, buttonKeys, toggleLines } from '../src/review';
import { bitbucket, github, useSite } from '../src/sites';

type Line = [' ' | '+' | '-', string] | ['@@'] | ['comment', string];

// Mirrors Bitbucket Cloud's div-based diff (seen on bitbucket.org/atlassian/aui pull requests).
function renderFile(lines: Line[], path = 'src/a.ts'): HTMLElement {
  const sections: string[][] = [];
  for (const line of lines) {
    if (line[0] === '@@') {
      sections.push([]);
      continue;
    }
    const [kind, text] = line;
    if (kind === 'comment') {
      sections[sections.length - 1].push(`<div class="comment-thread">${text}</div>`);
      continue;
    }
    const type = kind === '+' ? 'add' : kind === '-' ? 'del' : 'normal';
    sections[sections.length - 1].push(
      `<div class="lines-wrapper" role="row"><div class="line-wrapper type-${type}" data-qa="code-line">` +
        `<div class="line-numbers" role="gridcell"><a class="line-number-permalink">1</a></div>` +
        `<pre class="code-component"><div><span class="diff-line-type">${kind}</span>` +
        `<span class="code-diff" role="gridcell" data-line-type="${kind}"><span>${text}</span></span></div></pre></div></div>`,
    );
  }
  const chunks = sections
    .map(
      (rows) =>
        `<div class="chunk-wrapper" role="rowgroup"><div class="diff-chunk"><div class="diff-chunk-inner">` +
        `<div class="chunk-heading-wrapper"><button aria-label="Show more lines above"></button></div>${rows.join('')}</div></div></div>`,
    )
    .join('');
  document.body.innerHTML =
    `<div data-qa="branch-diff-file" aria-label="Diff of file ${path}">` +
    `<div data-qa="bk-file__header"><h2 data-qa="bk-filepath">${path}</h2>` +
    `<div data-qa="bk-file__actions"><label><input type="checkbox"><svg></svg><span>Viewed</span></label></div></div>` +
    `<div data-qa="bk-file__content"><div class="bitkit-diff-wrapper-diff" role="grid"><div class="chunks-wrapper"><div class="chunks-scroll-wrapper">${chunks}</div></div></div></div></div>`;
  return document.querySelector<HTMLElement>('.bitkit-diff-wrapper-diff')!;
}

const sample: Line[] = [
  ['@@'],
  [' ', 'a'],
  ['-', 'old'],
  ['+', 'new'],
  ['comment', 'nice'],
  [' ', 'b'],
  ['@@'],
  [' ', 'c'],
  ['+', 'added'],
  [' ', 'd'],
];
const rows = (diff: HTMLElement) => [...diff.querySelectorAll<HTMLElement>('.diff-chunk-inner > *')];

beforeEach(() => useSite(bitbucket));
afterEach(() => {
  useSite(github);
  document.body.innerHTML = '';
});

describe('Bitbucket Cloud', () => {
  it('reads the file path, sections and changed lines', () => {
    const file = parseFile(renderFile(sample))!;
    expect(file.path).toBe('src/a.ts');
    expect(file.root.matches('[data-qa="branch-diff-file"]')).toBe(true);
    expect(file.hunks.map((h) => h.lines.map((l) => `${l.side}${l.text}`))).toEqual([['-old', '+new'], ['+added']]);
    expect(file.hunks[0].lines.map(({ before, after }) => [before, after])).toEqual([
      [['a'], ['b']],
      [['a'], ['b']],
    ]);
    // The comment thread under "+new" belongs to the hunk.
    expect(file.hunks[0].rows).toHaveLength(3);
  });

  it('puts the button in the line-number gutter, or on the line for the right side', () => {
    const diff = renderFile(sample);
    applyFile(diff, new Set());
    const buttons = [...diff.querySelectorAll('.ghr-toggle')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].parentElement!.matches('.line-numbers')).toBe(true);
    applyFile(diff, new Set(), 'right');
    expect(diff.querySelector('.ghr-toggle')!.parentElement!.matches('.line-wrapper')).toBe(true);
    expect(document.querySelector('[data-qa="bk-filepath"] + .ghr-progress')!.textContent).toBe('0/2 hunks');
  });

  it('collapses reviewed lines into one row', () => {
    const diff = renderFile(sample);
    const hidden = new Set<string>();
    applyFile(diff, hidden);
    const first = diff.querySelector<HTMLButtonElement>('.ghr-toggle')!;
    expect(toggleLines(diff, buttonKeys(first), 'hide', hidden).hunks).toBe(1);
    const flags = rows(diff)
      .map((r) => (r.hasAttribute('data-ghr-collapsed') ? 'C' : r.hasAttribute('data-ghr-hidden') ? 'H' : '.'))
      .join('');
    // heading, a, old (placeholder), new, comment, b | heading, c, added, d
    expect(flags).toBe('..CHH.....');
  });

  it('ticks the Viewed checkbox once every hunk of the file is reviewed', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    history.replaceState(null, '', '/o/r/pull-requests/1/diff');
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const diff = renderFile(sample);
    const store = {
      load: vi.fn(async () => new Set<string>()),
      update: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
      setViewed: vi.fn(async () => {}),
      takeViewed: vi.fn(async () => undefined),
    };
    const controller = createController(store);
    controller.scan();
    await flush();
    await flush();
    const checkbox = document.querySelector('input')!;
    controller.toggle(diff.querySelectorAll<HTMLButtonElement>('.ghr-toggle')[0]);
    expect(checkbox.checked).toBe(false);
    controller.toggle(diff.querySelectorAll<HTMLButtonElement>('.ghr-toggle')[1]);
    expect(checkbox.checked).toBe(true);
    await flush();
    expect(store.setViewed).toHaveBeenCalledWith('ghr:bitbucket.org/o/r#1', 'Diff of file src/a.ts', {
      hunks: 0,
      lines: 0,
      files: 1,
    });
    vi.unstubAllGlobals();
  });

  it('builds its own PR key, apart from GitHub', () => {
    expect(bitbucket.prKey('/Atlassian/AUI/pull-requests/5470/diff')).toBe('ghr:bitbucket.org/atlassian/aui#5470');
    expect(bitbucket.prKey('/atlassian/aui/pull-requests/5470')).toBe('ghr:bitbucket.org/atlassian/aui#5470');
    expect(bitbucket.prKey('/atlassian/aui/src/master')).toBeNull();
  });
});
