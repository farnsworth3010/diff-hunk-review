import { assignKeys } from './hunkKey';
import { site } from './sites';

// Lines on each side of a changed line that go into its key, so moved code gets a new one.
const NEIGHBOR_LINES = 2;

// One changed line: a deletion on the old side or an addition on the new side.
export interface ChangeLine {
  side: '-' | '+';
  text: string;
  code: Element;
  row: HTMLElement;
  // Neighbouring lines on the same side, so unified and split views give the same key.
  before: string[];
  after: string[];
  key: string;
}

// A hunk is a block of consecutive changed lines, like `stage hunk` in an editor.
export interface Hunk {
  head: HTMLElement;
  // Changed rows plus inline comment rows attached to them.
  rows: HTMLElement[];
  lines: ChangeLine[];
}

export interface DiffFile {
  table: HTMLElement;
  root: HTMLElement;
  path: string;
  hunks: Hunk[];
}

interface Item {
  text: string;
  line?: ChangeLine;
}

export function parseFile(table: HTMLElement): DiffFile | null {
  const path = site().path(table);
  if (!path) return null;
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  // Old-side and new-side line sequences of the current "@@" section.
  let old: Item[] = [];
  let next: Item[] = [];
  const closeSection = () => {
    linkNeighbors(old);
    linkNeighbors(next);
    old = [];
    next = [];
  };

  for (const row of site().rows(table)) {
    const info = site().classify(row);
    // Lines on either side of a section boundary aren't adjacent in the file.
    if (info.kind === 'header') {
      open = null;
      closeSection();
      continue;
    }
    if (info.kind === 'other') {
      open?.rows.push(row);
      continue;
    }
    if (info.kind === 'context') {
      old.push({ text: info.text });
      next.push({ text: info.text });
      open = null;
      continue;
    }
    const lines: ChangeLine[] = info.lines.map((line) => ({ ...line, row, before: [], after: [], key: '' }));
    for (const line of lines) (line.side === '-' ? old : next).push({ text: line.text, line });
    if (!open) {
      open = { head: row, rows: [], lines: [] };
      hunks.push(open);
    }
    open.rows.push(row);
    open.lines.push(...lines);
  }
  closeSection();

  const file = { table, root: site().root(table), path, hunks };
  assignKeys(file);
  return file;
}

function linkNeighbors(items: Item[]): void {
  items.forEach(({ line }, i) => {
    if (!line) return;
    line.before = items.slice(Math.max(0, i - NEIGHBOR_LINES), i).map((item) => item.text);
    line.after = items.slice(i + 1, i + 1 + NEIGHBOR_LINES).map((item) => item.text);
  });
}
