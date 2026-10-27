// Everything that differs between GitHub and Bitbucket Cloud markup lives here.

export type RowInfo =
  | { kind: 'header' }
  | { kind: 'other' }
  | { kind: 'context'; text: string }
  | { kind: 'change'; lines: { side: '-' | '+'; text: string; code: Element }[] };

export interface Site {
  id: 'github' | 'bitbucket';
  // The element holding one file's diff rows; also the area hit-tested for sticky headers.
  diff: string;
  // Mutations under these nodes can change a line's text.
  content: string;
  // Added or removed nodes like these change the rows.
  rowNodes: string;
  prKey(pathname: string): string | null;
  rows(diff: HTMLElement): HTMLElement[];
  classify(row: HTMLElement): RowInfo;
  path(diff: HTMLElement): string | null;
  // The whole file block, with its header.
  root(diff: HTMLElement): HTMLElement;
  heading(root: HTMLElement): Element | null;
  container(row: HTMLElement, position: 'left' | 'right'): HTMLElement;
  // Stable id of a file block, for remembering what marking it Viewed counted.
  fileId(root: HTMLElement): string;
  // The site's own per-file "Viewed" control, and whether it is ticked.
  viewedControl(root: HTMLElement): HTMLElement | null;
  isChecked(control: HTMLElement): boolean;
  // For a click on a Viewed control: its file, and whether the click ticks (not unticks) it.
  viewedClick(target: EventTarget | null): { root: HTMLElement; viewing: boolean } | null;
}

const text = (el: Element | null) => el?.textContent ?? '';

export const github: Site = {
  id: 'github',
  diff: 'table[data-diff-anchor]',
  content: 'code.diff-text, .diff-text-cell',
  rowNodes: 'tr, tbody, code.diff-text',
  prKey(pathname) {
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/|$)/.exec(pathname);
    return match && `ghr:${match[1].toLowerCase()}/${match[2].toLowerCase()}#${match[3]}`;
  },
  rows: (diff) => [...diff.querySelectorAll<HTMLElement>(':scope > tbody > tr')],
  classify(row) {
    // Blue "@@" rows and the file's trailing "expand down" row.
    if (row.querySelector(':scope > td.diff-hunk-cell')) return { kind: 'header' };
    const codes = [...row.querySelectorAll(':scope > td > code.diff-text')];
    if (!codes.length) return { kind: 'other' };
    const lineText = (code: Element) => text(code.querySelector('.diff-text-inner') ?? code);
    const lines = codes.flatMap((code) => {
      const side = code.classList.contains('deletion') ? '-' : code.classList.contains('addition') ? '+' : null;
      return side ? [{ side, text: lineText(code), code } as const] : [];
    });
    return lines.length ? { kind: 'change', lines } : { kind: 'context', text: lineText(codes[0]) };
  },
  path(diff) {
    const label = diff.getAttribute('aria-label') ?? '';
    if (label.startsWith('Diff for: ')) return label.slice('Diff for: '.length);
    return (
      text(this.heading(this.root(diff)))
        .replace(/‎/g, '')
        .trim() || null
    );
  },
  root(diff) {
    const anchor = diff.getAttribute('data-diff-anchor');
    return (anchor && document.getElementById(anchor)) || diff.closest<HTMLElement>('[id^="diff-"]') || diff;
  },
  heading: (root) => root.querySelector('h3'),
  container(row, position) {
    const cells = (row as HTMLTableRowElement).cells;
    return position === 'left' ? cells[0] : cells[cells.length - 1];
  },
  fileId: (root) => root.id,
  viewedControl: (root) =>
    [...root.querySelectorAll<HTMLElement>('button[aria-pressed]')].find((b) => b.textContent?.trim() === 'Viewed') ??
    null,
  isChecked: (control) => control.getAttribute('aria-pressed') === 'true',
  viewedClick(target) {
    const button = target instanceof Element ? target.closest<HTMLElement>('button[aria-pressed]') : null;
    const root = button?.closest<HTMLElement>('[id^="diff-"]');
    if (!button || !root || button.textContent?.trim() !== 'Viewed') return null;
    // Listeners run before GitHub flips aria-pressed, so it still holds the old state.
    return { root, viewing: !this.isChecked(button) };
  },
};

export const bitbucket: Site = {
  id: 'bitbucket',
  diff: '.bitkit-diff-wrapper-diff',
  content: '.code-diff, .code-component',
  rowNodes: '.lines-wrapper, .chunk-wrapper, .diff-chunk-inner, .code-diff',
  prKey(pathname) {
    const match = /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/.exec(pathname);
    return match && `ghr:bitbucket.org/${match[1].toLowerCase()}/${match[2].toLowerCase()}#${match[3]}`;
  },
  rows: (diff) => [...diff.querySelectorAll<HTMLElement>('.diff-chunk-inner > *')],
  classify(row) {
    // Each section starts with a heading holding the "show more lines" button.
    if (row.matches('.chunk-heading-wrapper')) return { kind: 'header' };
    const code = row.matches('.lines-wrapper') ? row.querySelector<HTMLElement>('.code-diff[data-line-type]') : null;
    if (!code) return { kind: 'other' };
    const side = code.dataset.lineType;
    if (side === '-' || side === '+') return { kind: 'change', lines: [{ side, text: text(code), code }] };
    return { kind: 'context', text: text(code) };
  },
  path(diff) {
    const label = this.root(diff).getAttribute('aria-label') ?? '';
    if (label.startsWith('Diff of file ')) return label.slice('Diff of file '.length);
    return text(this.heading(this.root(diff))).trim() || null;
  },
  root: (diff) => diff.closest<HTMLElement>('[data-qa="branch-diff-file"]') ?? diff,
  heading: (root) => root.querySelector('[data-qa="bk-filepath"]'),
  container(row, position) {
    const selector = position === 'left' ? '.line-numbers' : '.line-wrapper';
    return row.querySelector<HTMLElement>(selector) ?? row;
  },
  fileId: (root) => root.getAttribute('aria-label') ?? '',
  viewedControl: (root) =>
    [...root.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === 'Viewed')
      ?.querySelector<HTMLElement>('input[type="checkbox"]') ?? null,
  isChecked: (control) => (control as HTMLInputElement).checked,
  viewedClick(target) {
    // A click on the label also reaches the checkbox as a second click; only that one counts,
    // and by then the browser has already flipped `checked`.
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return null;
    const root = target.closest<HTMLElement>('[data-qa="branch-diff-file"]');
    if (!root || target.closest('label')?.textContent?.trim() !== 'Viewed') return null;
    return { root, viewing: target.checked };
  },
};

let active: Site = typeof location !== 'undefined' && location.hostname === 'bitbucket.org' ? bitbucket : github;

export function site(): Site {
  return active;
}

// For tests.
export function useSite(next: Site): void {
  active = next;
}
