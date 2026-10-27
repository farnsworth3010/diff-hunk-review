import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController, type HiddenStore } from '../src/controller';
import { parseFile } from '../src/dom';
import { buttonKeys } from '../src/review';
import { github } from '../src/sites';
import { renderFile, sample } from './fixture';

const PR = 'ghr:o/r#1';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(store: Partial<HiddenStore> = {}) {
  const table = renderFile(sample);
  const file = parseFile(table)!;
  const keys = file.hunks.map((hunk) => hunk.lines.map((line) => line.key));
  const full: HiddenStore = {
    load: vi.fn(async () => new Set<string>()),
    update: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    setViewed: vi.fn(async () => {}),
    takeViewed: vi.fn(async () => undefined),
    ...store,
  };
  const controller = createController(full);
  const observer = new MutationObserver((m) => controller.onMutations(m));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  return { table, keys, store: full, controller, observer };
}

const collapsed = (table: HTMLTableElement) => table.querySelectorAll('[data-ghr-collapsed]').length;
const button = (table: HTMLTableElement, i = 0) => table.querySelectorAll<HTMLButtonElement>('.ghr-toggle')[i];

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  history.replaceState(null, '', '/o/r/pull/1/changes');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  cleanup?.();
  // Drain frames the previous controller scheduled, so they can't touch the next test's DOM.
  await flush();
  await flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('controller', () => {
  it('loads the PR state and applies it', async () => {
    const reviewed = new Set(keys0());
    const { table, keys, controller, observer, store } = setup({ load: vi.fn(async () => reviewed) });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    expect(store.load).toHaveBeenCalledWith(PR);
    expect(collapsed(table)).toBe(1);
    expect(keys).toHaveLength(3);
  });

  it('ignores a load that finishes after switching to another PR', async () => {
    const first = deferred<Set<string>>();
    const reviewed = new Set(keys0());
    const { table, controller, observer } = setup({
      load: vi.fn((key: string) => (key === PR ? first.promise : Promise.resolve(new Set<string>()))),
    });
    cleanup = () => observer.disconnect();
    controller.scan();
    history.replaceState(null, '', '/o/r/pull/2/changes');
    controller.scan();
    first.resolve(reviewed);
    await flush();
    await flush();
    expect(collapsed(table)).toBe(0);
  });

  it('retries after a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(new Set(keys0()));
    const { table, controller, observer } = setup({ load });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    controller.scan();
    await flush();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(collapsed(table)).toBe(1);
  });

  it('saves a toggle and rolls it back when saving fails', async () => {
    const update = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'));
    const { table, keys, controller, observer } = setup({ update });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();

    controller.toggle(button(table, 0));
    expect(update).toHaveBeenLastCalledWith(PR, keys[0], []);
    expect(collapsed(table)).toBe(1);

    controller.toggle(button(table, 1));
    expect(collapsed(table)).toBe(2);
    await flush();
    await flush();
    expect(update).toHaveBeenLastCalledWith(PR, keys[1], []);
    expect(collapsed(table)).toBe(1);
  });

  it('applies changes from another tab, but not while its own write is in flight', async () => {
    const write = deferred<void>();
    const { table, keys, controller, observer } = setup({ update: vi.fn(() => write.promise) });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();

    controller.toggle(button(table, 0));
    controller.onStoredChange(PR, new Set());
    await flush();
    expect(collapsed(table)).toBe(1);

    write.resolve();
    await flush();
    controller.onStoredChange(PR, new Set([...keys[1], ...keys[2]]));
    await flush();
    expect(collapsed(table)).toBe(2);
    expect(button(table, 0).getAttribute('aria-pressed')).toBe('false');
  });

  it('puts the button back when GitHub re-renders the row', async () => {
    const { table, controller, observer } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    button(table, 0).remove();
    await flush();
    await flush();
    expect(table.querySelectorAll('.ghr-toggle')).toHaveLength(3);
  });
});

describe('controller settings and stats', () => {
  it('records reviewed hunks and lines, and takes them back when unmarked', async () => {
    const { table, controller, observer, store } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    controller.toggle(button(table, 0));
    expect(store.record).toHaveBeenLastCalledWith({ hunks: 1, lines: 2, files: 0 });
    controller.toggle(button(table, 0));
    expect(store.record).toHaveBeenLastCalledWith({ hunks: -1, lines: -2, files: 0 });
  });

  it('removes everything when disabled and restores it when enabled', async () => {
    const reviewed = new Set(keys0());
    const { table, controller, observer } = setup({ load: vi.fn(async () => reviewed) });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    expect(collapsed(table)).toBe(1);

    controller.setSettings({ enabled: false, position: 'left', autoViewed: true });
    expect(
      document.querySelectorAll('.ghr-toggle, .ghr-progress, [data-ghr-hidden], [data-ghr-collapsed]'),
    ).toHaveLength(0);
    await flush();
    await flush();
    expect(document.querySelectorAll('.ghr-toggle')).toHaveLength(0);

    controller.setSettings({ enabled: true, position: 'left', autoViewed: true });
    await flush();
    await flush();
    expect(collapsed(table)).toBe(1);
    expect(table.querySelectorAll('.ghr-toggle')).toHaveLength(3);
  });

  it('moves buttons when the position changes', async () => {
    const { table, controller, observer } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    const row = button(table, 0).closest('tr')!;
    expect(button(table, 0).parentElement).toBe(row.cells[0]);

    controller.setSettings({ enabled: true, position: 'right', autoViewed: true });
    await flush();
    await flush();
    expect(button(table, 0).parentElement).toBe(row.cells[row.cells.length - 1]);
    expect(table.querySelectorAll('.ghr-toggle')).toHaveLength(3);
  });
});

describe('GitHub Viewed checkbox', () => {
  const viewed = (pressed: boolean) => {
    document
      .querySelector('#diff-abc > div')!
      .insertAdjacentHTML('beforeend', `<button aria-pressed="${pressed}">Viewed</button>`);
    return document.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  };

  // What the content script does with a click on the checkbox.
  const click = (controller: ReturnType<typeof setup>['controller'], checkbox: HTMLButtonElement) => {
    const viewedClick = github.viewedClick(checkbox)!;
    controller.viewedClicked(viewedClick.root, viewedClick.viewing);
  };

  it('counts the file and its not yet reviewed hunks when marked Viewed', async () => {
    const reviewed = new Set(keys0());
    const { controller, observer, store } = setup({ load: vi.fn(async () => reviewed) });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    click(controller, viewed(false));
    await flush();
    // Three hunks of one and two lines; the first one was already marked with our button.
    const counts = { hunks: 2, lines: 2, files: 1 };
    expect(store.setViewed).toHaveBeenCalledWith(PR, 'diff-abc', counts);
    expect(store.record).toHaveBeenCalledWith(counts);
  });

  it('takes back what marking added when the checkbox is cleared', async () => {
    const counts = { hunks: 3, lines: 9, files: 1 };
    const { controller, observer, store } = setup({ takeViewed: vi.fn(async () => counts) });
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    click(controller, viewed(true));
    await flush();
    expect(store.takeViewed).toHaveBeenCalledWith(PR, 'diff-abc');
    expect(store.record).toHaveBeenCalledWith({ hunks: -3, lines: -9, files: -1 });
  });

  it('ticks Viewed when the last hunk of the file gets reviewed, and only then', async () => {
    const { table, controller, observer, store } = setup();
    cleanup = () => observer.disconnect();
    const checkbox = viewed(false);
    const onClick = vi.fn(() => checkbox.setAttribute('aria-pressed', 'true'));
    checkbox.addEventListener('click', onClick);
    controller.scan();
    await flush();
    await flush();

    controller.toggle(button(table, 0));
    controller.toggle(button(table, 2));
    expect(onClick).not.toHaveBeenCalled();
    controller.toggle(button(table, 1));
    expect(onClick).toHaveBeenCalledTimes(1);
    await flush();
    expect(store.setViewed).toHaveBeenCalledWith(PR, 'diff-abc', { hunks: 0, lines: 0, files: 1 });

    // Unticked by hand: a rescan or showing a hunk doesn't tick it again; reviewing the last hunk again does.
    checkbox.setAttribute('aria-pressed', 'false');
    controller.scan();
    controller.toggle(button(table, 0));
    controller.toggle(button(table, 0));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('leaves Viewed alone when automatic Viewed is turned off', async () => {
    const { table, controller, observer } = setup();
    cleanup = () => observer.disconnect();
    const checkbox = viewed(false);
    const onClick = vi.fn();
    checkbox.addEventListener('click', onClick);
    controller.setSettings({ enabled: true, position: 'left', autoViewed: false });
    controller.scan();
    await flush();
    await flush();
    // Review all three hunks, each time with the first remaining "Mark reviewed" button.
    for (let i = 0; i < 3; i++) {
      controller.toggle(table.querySelector<HTMLButtonElement>('.ghr-toggle[data-ghr-action="hide"]')!);
    }
    expect(table.querySelectorAll('[data-ghr-collapsed]')).toHaveLength(3);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('records nothing for a cleared checkbox it never counted', async () => {
    const { controller, observer, store } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    click(controller, viewed(true));
    await flush();
    expect(store.record).not.toHaveBeenCalled();
  });
});

describe('sticky button', () => {
  // jsdom has no layout: give the table and each row a fake position, and make
  // hit-testing return the file header above `headerBottom` and the table below it.
  function layout(table: HTMLTableElement, headerBottom: number) {
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 10, right: 610 }) as DOMRect;
    const header = document.querySelector('#diff-abc > div')!;
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(50, 1000));
    table.querySelectorAll('tbody > tr').forEach((row, i) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(80 + i * 20, 100 + i * 20));
    });
    document.elementFromPoint = (_x: number, y: number) => (y < headerBottom ? header : table.rows[0]);
  }
  const sticky = () => document.querySelector<HTMLButtonElement>('.ghr-sticky');

  it('follows a long hunk whose first row scrolled under the file header, and collapses it', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { controller, observer, keys } = setup();
    cleanup = () => observer.disconnect();
    const table = document.querySelector('table')!;
    controller.scan();
    await flush();
    await flush();

    // Hunk 1 spans rows 2-4 (y 120-180); a header bottom at 130 hides its first row.
    layout(table, 130);
    controller.onScroll();
    await flush();
    expect(sticky()?.hidden).toBe(false);
    expect(buttonKeys(sticky()!)).toEqual(keys[0]);
    expect(sticky()?.style.top).toBe('134px');
    expect(sticky()?.style.left).toBe('14px');

    controller.toggle(sticky()!);
    expect(collapsed(table)).toBe(1);
    expect(sticky()?.hidden).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('hides in-row buttons whose row is under the header', async () => {
    const { controller, observer } = setup();
    cleanup = () => observer.disconnect();
    const table = document.querySelector('table')!;
    controller.scan();
    await flush();
    await flush();
    layout(table, 130);
    for (const el of table.querySelectorAll<HTMLElement>('.ghr-toggle')) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(el.closest('tr')!.getBoundingClientRect());
    }
    controller.onScroll();
    await flush();
    // Buttons sit on rows 2, 6 and 10, at y 120, 200 and 280.
    expect([...table.querySelectorAll('.ghr-toggle')].map((el) => el.hasAttribute('data-ghr-covered'))).toEqual([
      true,
      false,
      false,
    ]);

    // A different header height comes with a resize, which drops the remembered cover.
    layout(table, 60);
    controller.onResize();
    await flush();
    expect(table.querySelectorAll('[data-ghr-covered]')).toHaveLength(0);
  });

  it('stays hidden while each hunk starts below the header', async () => {
    const { controller, observer } = setup();
    cleanup = () => observer.disconnect();
    const table = document.querySelector('table')!;
    controller.scan();
    await flush();
    await flush();
    layout(table, 60);
    controller.onScroll();
    await flush();
    expect(sticky()?.hidden ?? true).toBe(true);
  });
});

describe('selection button', () => {
  const codes = () => [...document.querySelectorAll('table code.diff-text')];
  const select = (start: Node, startOffset: number, end: Node, endOffset: number) => {
    const range = document.createRange();
    range.setStart(start, startOffset);
    range.setEnd(end, endOffset);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  };
  const selectButton = () => document.querySelector<HTMLButtonElement>('.ghr-select');

  beforeEach(() => {
    // jsdom has no layout for ranges.
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 100, bottom: 120, left: 0, right: 300, width: 300, height: 20 }) as DOMRect;
  });

  it('offers to mark the selected changed lines and hides them', async () => {
    const { table, keys, controller, observer, store } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();

    // From the middle of "-old" to the middle of "+added": context lines in between don't count.
    const c = codes();
    const old = c.find((el) => el.textContent === 'old')!;
    const added = c.find((el) => el.textContent === 'added')!;
    select(
      old.querySelector('.diff-text-inner')!.firstChild!,
      1,
      added.querySelector('.diff-text-inner')!.firstChild!,
      2,
    );
    controller.onScroll();
    await flush();
    expect(selectButton()?.hidden).toBe(false);
    expect(selectButton()?.querySelector('.ghr-label')?.textContent).toBe('Mark 3 lines reviewed');
    expect(buttonKeys(selectButton()!)).toEqual([...keys[0], ...keys[1]]);

    controller.toggle(selectButton()!);
    expect(collapsed(table)).toBe(2);
    expect(store.record).toHaveBeenLastCalledWith({ hunks: 2, lines: 3, files: 0 });
    expect(document.getSelection()!.isCollapsed).toBe(true);
    expect(selectButton()?.hidden).toBe(true);
  });

  it('does not take the next line when the selection ends at its very start', async () => {
    const { controller, observer } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    const [old, next] = codes().filter((el) => el.textContent === 'old' || el.textContent === 'new');
    select(old, 0, next, 0);
    controller.onScroll();
    await flush();
    expect(selectButton()?.querySelector('.ghr-label')?.textContent).toBe('Mark 1 line reviewed');
  });

  it('shows nothing for a selection of context lines only, or outside the diff', async () => {
    const { controller, observer } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    const a = codes().find((el) => el.textContent === 'a')!;
    select(a, 0, a, 1);
    controller.onScroll();
    await flush();
    expect(selectButton()?.hidden ?? true).toBe(true);
    select(document.querySelector('h3')!, 0, document.querySelector('h3')!, 1);
    controller.onScroll();
    await flush();
    expect(selectButton()?.hidden ?? true).toBe(true);
  });

  it('waits for the mouse to be released before showing up', async () => {
    const { controller, observer } = setup();
    cleanup = () => observer.disconnect();
    controller.scan();
    await flush();
    await flush();
    const old = codes().find((el) => el.textContent === 'old')!;
    controller.setPointerDown(true);
    select(old, 0, old, 1);
    controller.onScroll();
    await flush();
    expect(selectButton()?.hidden ?? true).toBe(true);
    controller.setPointerDown(false);
    await flush();
    expect(selectButton()?.hidden).toBe(false);
  });
});

// Line keys of the first hunk.
function keys0(): string[] {
  return parseFile(renderFile(sample))!.hunks[0].lines.map((line) => line.key);
}
