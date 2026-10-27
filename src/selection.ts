import { parseFile } from './dom';
import { createToggle, describe } from './review';
import { site } from './sites';

const GAP = 8;
const WIDTH = 220;
const HEIGHT = 24;

interface Target {
  table: HTMLElement;
  keys: string[];
}

// Whether the range covers part of the node's contents; touching its start or end doesn't count,
// so a triple-click that ends at the start of the next row doesn't take that row along.
function overlaps(range: Range, node: Node): boolean {
  const contents = document.createRange();
  contents.selectNodeContents(node);
  return (
    range.compareBoundaryPoints(Range.END_TO_START, contents) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, contents) > 0
  );
}

// A floating "Mark N lines reviewed" button next to a text selection inside a diff.
export function createSelectionButton() {
  let button: HTMLButtonElement | null = null;
  let target: Target | null = null;

  function ensure(): HTMLButtonElement {
    if (!button?.isConnected) {
      button = createToggle();
      button.classList.add('ghr-select');
      document.body.append(button);
    }
    return button;
  }

  function find(hidden: ReadonlySet<string>): (Target & { range: Range }) | null {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const table = (common instanceof Element ? common : common.parentElement)?.closest<HTMLElement>(site().diff);
    if (!table) return null;
    const file = parseFile(table);
    if (!file) return null;
    const keys = file.hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => !hidden.has(line.key) && overlaps(range, line.code))
      .map((line) => line.key);
    return keys.length ? { table, keys, range } : null;
  }

  function update(hidden: ReadonlySet<string>): void {
    const found = find(hidden);
    target = found && { table: found.table, keys: found.keys };
    if (!found) {
      if (button && !button.hidden) button.hidden = true;
      return;
    }
    const el = ensure();
    const n = found.keys.length;
    describe(
      el,
      found.keys,
      'hide',
      `Mark ${n} ${n === 1 ? 'line' : 'lines'} reviewed`,
      'Hide the selected lines as reviewed',
    );
    // Next to where the selection ends, kept inside the viewport.
    const rects = [...found.range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const end = rects[rects.length - 1] ?? found.range.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    el.hidden = false;
    el.style.left = `${Math.max(GAP, Math.min(end.right + GAP, width - WIDTH))}px`;
    el.style.top = `${Math.max(GAP, Math.min(end.top + (end.height - HEIGHT) / 2, window.innerHeight - HEIGHT - GAP))}px`;
  }

  function targetOf(el: Element): Target | null {
    return el === button ? target : null;
  }

  function hide(): void {
    if (button) button.hidden = true;
    target = null;
  }

  return { update, targetOf, hide };
}
