import { type ChangeLine, type DiffFile, type Hunk, parseFile } from './dom';
import type { ButtonPosition } from './settings';
import { site } from './sites';
import type { Counts } from './stats';

export interface OpenHunk {
  hunk: Hunk;
  // Lines of the hunk not reviewed yet.
  keys: string[];
}

export interface FileState {
  file: DiffFile;
  // Hunks with every line reviewed.
  reviewed: number;
  // Hunks with lines left to review, in page order.
  open: OpenHunk[];
}

type Action = 'hide' | 'show';

interface Toggle {
  action: Action;
  lines: ChangeLine[];
  title: string;
}

export function reviewedCount(file: DiffFile, hidden: ReadonlySet<string>): number {
  return file.hunks.filter((hunk) => hunk.lines.every((line) => hidden.has(line.key))).length;
}

// Idempotent: a second call on an unchanged table makes no DOM writes, so the observer settles.
export function applyFile(
  table: HTMLElement,
  hidden: ReadonlySet<string>,
  position: ButtonPosition = 'left',
): FileState | null {
  const file = parseFile(table);
  if (!file) return null;
  const hiddenRows = new Set<HTMLElement>();
  const collapsed = new Set<HTMLElement>();
  const toggles = new Map<HTMLElement, Toggle>();
  const open: OpenHunk[] = [];
  let reviewed = 0;

  for (const hunk of file.hunks) {
    // Consecutive reviewed rows collapse into their first row, which keeps a "show" button.
    for (const run of reviewedRuns(hunk, hidden)) {
      const [first, ...rest] = run.rows;
      collapsed.add(first);
      for (const row of rest) hiddenRows.add(row);
      toggles.set(first, { action: 'show', lines: run.lines, title: 'Show these lines again' });
    }
    const left = hunk.lines.filter((line) => !hidden.has(line.key));
    if (!left.length) {
      reviewed++;
      continue;
    }
    open.push({ hunk, keys: left.map((line) => line.key) });
    const partial = left.length < hunk.lines.length;
    toggles.set(left[0].row, {
      action: 'hide',
      lines: left,
      title: partial ? `Hide the ${left.length} remaining lines of this hunk` : 'Hide this hunk as reviewed',
    });
  }

  for (const row of site().rows(table)) {
    setFlag(row, 'data-ghr-hidden', hiddenRows.has(row));
    setFlag(row, 'data-ghr-collapsed', collapsed.has(row));
    const toggle = toggles.get(row);
    if (toggle) ensureToggle(row, toggle, position);
    else row.querySelector('.ghr-toggle')?.remove();
  }
  ensureProgress(file, reviewed);
  return { file, reviewed, open };
}

function reviewedRuns(hunk: Hunk, hidden: ReadonlySet<string>): { rows: HTMLElement[]; lines: ChangeLine[] }[] {
  const byRow = new Map<HTMLElement, ChangeLine[]>();
  for (const line of hunk.lines) byRow.set(line.row, [...(byRow.get(line.row) ?? []), line]);
  const runs: { rows: HTMLElement[]; lines: ChangeLine[] }[] = [];
  let run: (typeof runs)[number] | null = null;
  for (const row of hunk.rows) {
    const lines = byRow.get(row);
    // Comment rows follow the changed row above them.
    const reviewed = lines ? lines.every((line) => hidden.has(line.key)) : run !== null;
    if (!reviewed) {
      run = null;
      continue;
    }
    if (!run) {
      run = { rows: [], lines: [] };
      runs.push(run);
    }
    run.rows.push(row);
    if (lines) run.lines.push(...lines);
  }
  return runs;
}

// Marks or unmarks lines; returns the keys that actually changed and how the reviewed-hunk count moved.
export function toggleLines(
  table: HTMLElement,
  keys: string[],
  action: Action,
  hidden: Set<string>,
  position: ButtonPosition = 'left',
): { changed: string[]; hunks: number; state: FileState | null } {
  const file = parseFile(table);
  const before = file ? reviewedCount(file, hidden) : 0;
  const changed = keys.filter((key) => hidden.has(key) === (action === 'show'));
  for (const key of changed) {
    if (action === 'hide') hidden.add(key);
    else hidden.delete(key);
  }
  const state = applyFile(table, hidden, position);
  return { changed, hunks: (state?.reviewed ?? 0) - before, state };
}

// Hunks and lines of a file not reviewed yet, counted when the file is marked Viewed.
export function unreviewed(table: HTMLElement, hidden: ReadonlySet<string>): Omit<Counts, 'files'> {
  const file = parseFile(table);
  if (!file) return { hunks: 0, lines: 0 };
  const lines = file.hunks.flatMap((hunk) => hunk.lines).filter((line) => !hidden.has(line.key));
  return { hunks: file.hunks.length - reviewedCount(file, hidden), lines: lines.length };
}

// Removes everything the extension added, for when it is switched off.
export function clearAll(root: ParentNode = document): void {
  for (const node of root.querySelectorAll('.ghr-toggle, .ghr-progress')) node.remove();
  for (const row of root.querySelectorAll('[data-ghr-hidden], [data-ghr-collapsed]')) {
    row.removeAttribute('data-ghr-hidden');
    row.removeAttribute('data-ghr-collapsed');
  }
}

export function counts(lines: Pick<ChangeLine, 'side'>[]): string {
  const deletions = lines.filter((line) => line.side === '-').length;
  const additions = lines.length - deletions;
  return [deletions && `−${deletions}`, additions && `+${additions}`].filter(Boolean).join(' ');
}

export function describe(button: HTMLButtonElement, keys: string[], action: Action, label: string, title: string) {
  const encoded = JSON.stringify(keys);
  const pressed = String(action === 'show');
  const text = button.querySelector('.ghr-label');
  if (button.dataset.ghrKeys !== encoded) button.dataset.ghrKeys = encoded;
  if (button.dataset.ghrAction !== action) button.dataset.ghrAction = action;
  if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  if (button.title !== title) button.title = title;
  if (text && text.textContent !== label) text.textContent = label;
}

export function buttonKeys(button: HTMLElement): string[] {
  try {
    const keys: unknown = JSON.parse(button.dataset.ghrKeys ?? '[]');
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function ensureToggle(row: HTMLElement, toggle: Toggle, position: ButtonPosition): void {
  let button = row.querySelector<HTMLButtonElement>('button.ghr-toggle');
  button ??= createToggle();
  const container = site().container(row, position);
  if (button.parentElement !== container) container.append(button);
  if (button.dataset.ghrPosition !== position) button.dataset.ghrPosition = position;
  const label = toggle.action === 'show' ? `Reviewed ${counts(toggle.lines)} · show` : 'Mark reviewed';
  describe(
    button,
    toggle.lines.map((line) => line.key),
    toggle.action,
    label,
    toggle.title,
  );
}

export function createToggle(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghr-toggle';
  const icon = document.createElement('span');
  icon.className = 'ghr-icon';
  icon.textContent = '✓';
  const label = document.createElement('span');
  label.className = 'ghr-label';
  button.append(icon, label);
  return button;
}

function ensureProgress(file: DiffFile, reviewed: number): void {
  const heading = site().heading(file.root);
  if (!heading || !file.hunks.length) return;
  let badge = file.root.querySelector<HTMLElement>('.ghr-progress');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'ghr-progress';
    heading.after(badge);
  }
  const text = `${reviewed}/${file.hunks.length} hunks`;
  if (badge.textContent !== text) badge.textContent = text;
  setFlag(badge, 'data-ghr-done', reviewed === file.hunks.length);
}

function setFlag(element: Element, name: string, on: boolean): void {
  if (on && !element.hasAttribute(name)) element.setAttribute(name, '');
  else if (!on && element.hasAttribute(name)) element.removeAttribute(name);
}
