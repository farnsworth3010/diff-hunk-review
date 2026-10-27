import { createToggle, describe, type OpenHunk } from './review';
import type { ButtonPosition } from './settings';
import { site } from './sites';

const GAP = 4;
const HEIGHT = 24;
// Stuck headers (page, PR toolbar, file) end above this; nothing lower is hit-tested.
const MAX_COVER = 240;
// How long a measured header edge is trusted.
const COVER_TTL = 1000;

interface Target {
  table: HTMLElement;
  open: OpenHunk;
  line: number;
}

// A single floating button, outside React's tree, for the hunk whose first row has
// scrolled under the file header while the rest of it is still on screen.
export function createSticky() {
  let button: HTMLButtonElement | null = null;
  let target: Target | null = null;

  function ensure(): HTMLButtonElement {
    if (!button?.isConnected) {
      button = createToggle();
      button.classList.add('ghr-sticky');
      document.body.append(button);
    }
    return button;
  }

  // Where the stuck page header, PR toolbar and file header end above each table. Hit-testing
  // forces a layout of the whole page, which is costly while the site renders a big diff, so a
  // measured edge is kept for a while; it doesn't move as the page scrolls.
  // `top` is where the table started when nothing covered it: that answer holds until it moves.
  let covers = new WeakMap<HTMLElement, { at: number; bottom: number; top: number }>();

  // Top edge of the visible part of the table: whatever the site keeps stuck above it is found
  // by hit-testing rather than by its markup.
  function lineFor(table: HTMLElement, rect: DOMRect): number {
    let lo = Math.max(rect.top, 0);
    // Stuck headers never reach this far down.
    if (lo >= MAX_COVER) return lo;
    const now = performance.now();
    const cached = covers.get(table);
    if (cached?.bottom && now - cached.at < COVER_TTL) return Math.max(lo, cached.bottom);
    if (cached && !cached.bottom && Math.abs(cached.top - lo) < 1) return lo;

    // Mid-table, away from our gutter buttons; one topmost hit per probe.
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), document.documentElement.clientWidth - 1);
    const covered = (y: number) => {
      const el = document.elementFromPoint(x, y);
      return !!el && !el.closest('.ghr-toggle') && !table.contains(el);
    };
    if (!covered(lo)) {
      covers.set(table, { at: now, bottom: 0, top: lo });
      return lo;
    }
    let hi = Math.min(rect.bottom, window.innerHeight, MAX_COVER + HEIGHT) - 1;
    if (hi > lo && !covered(hi)) {
      // lo is covered and hi is visible; the cover is one block at the top.
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (covered(mid)) lo = mid;
        else hi = mid;
      }
    }
    covers.set(table, { at: now, bottom: hi, top: lo });
    return hi;
  }

  // After a resize the stuck headers may have changed height.
  function invalidate(): void {
    covers = new WeakMap();
  }

  function find(files: Map<HTMLElement, OpenHunk[]>): Target | null {
    for (const [table, hunks] of files) {
      if (!table.isConnected) {
        files.delete(table);
        continue;
      }
      const rect = table.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      const line = lineFor(table, rect);
      if (rect.top >= line || rect.bottom <= line + HEIGHT) continue;
      for (const open of hunks) {
        const { rows, head } = open.hunk;
        if (!head.isConnected) continue;
        const top = head.getBoundingClientRect().top;
        const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
        if (top < line && bottom > line + HEIGHT + GAP) return { table, open, line };
      }
    }
    return null;
  }

  // Hides in-row buttons whose row has scrolled under a sticky header; reads first, then writes.
  function cover(): void {
    const changes: [HTMLElement, boolean][] = [];
    for (const table of document.querySelectorAll<HTMLElement>(site().diff)) {
      const rect = table.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      const line = lineFor(table, rect);
      // Nothing covers this table: only buttons hidden earlier need showing again.
      const selector = line > Math.max(rect.top, 0) ? '.ghr-toggle' : '.ghr-toggle[data-ghr-covered]';
      for (const el of table.querySelectorAll<HTMLElement>(selector)) {
        changes.push([el, el.getBoundingClientRect().top < line]);
      }
    }
    for (const [el, covered] of changes) {
      if (covered !== el.hasAttribute('data-ghr-covered')) el.toggleAttribute('data-ghr-covered', covered);
    }
  }

  function update(files: Map<HTMLElement, OpenHunk[]>, position: ButtonPosition): void {
    cover();
    target = find(files);
    if (!target) {
      if (button && !button.hidden) button.hidden = true;
      return;
    }
    const el = ensure();
    const { table, open, line } = target;
    const rect = table.getBoundingClientRect();
    const rows = open.hunk.rows;
    const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
    el.hidden = false;
    describe(el, open.keys, 'hide', 'Mark reviewed', 'Hide the rest of this hunk as reviewed');
    el.dataset.ghrPosition = position;
    el.style.top = `${Math.min(line + GAP, bottom - HEIGHT - GAP)}px`;
    el.style.left = position === 'left' ? `${rect.left + GAP}px` : '';
    el.style.right = position === 'right' ? `${document.documentElement.clientWidth - rect.right + GAP * 2}px` : '';
  }

  // The table and the visible top line for a click on the sticky button.
  function targetOf(el: Element): Target | null {
    return el === button ? target : null;
  }

  function hide(): void {
    if (button) button.hidden = true;
    target = null;
  }

  return { update, targetOf, hide, invalidate };
}

// After collapsing from the sticky button, bring the collapsed row to where the button was.
export function alignBelow(row: HTMLElement, line: number): void {
  row.style.scrollMarginTop = `${line + GAP}px`;
  row.scrollIntoView({ block: 'start' });
  row.style.removeProperty('scroll-margin-top');
  if (!row.getAttribute('style')) row.removeAttribute('style');
}
