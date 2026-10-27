import { applyFile, buttonKeys, clearAll, type OpenHunk, toggleLines, unreviewed } from './review';
import { createSelectionButton } from './selection';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { site } from './sites';
import type { Counts } from './stats';
import { alignBelow, createSticky } from './sticky';

export interface HiddenStore {
  load(key: string): Promise<Set<string>>;
  update(key: string, add: string[], remove: string[]): Promise<void>;
  // Adds a hunk to (or, when unmarked, takes it out of) the review statistics.
  record(delta: Counts): Promise<void>;
  setViewed(key: string, anchor: string, counts: Counts): Promise<void>;
  takeViewed(key: string, anchor: string): Promise<Counts | undefined>;
}

const STICKY_DELAY = 250;

export function createController(store: HiddenStore) {
  let settings: Settings = DEFAULT_SETTINGS;
  let prKey: string | null = null;
  let hidden = new Set<string>();
  let loaded = false;
  let writes = 0;
  let lastUrl = '';
  let fullScan = true;
  let scheduled = false;
  const pending = new Set<HTMLElement>();
  // Hunks still shown per file, for the sticky button.
  const files = new Map<HTMLElement, OpenHunk[]>();
  const sticky = createSticky();
  const selection = createSelectionButton();
  let stickyScheduled = false;
  let pointerDown = false;

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  function scan(): void {
    if (!settings.enabled) return;
    const key = site().prKey(location.pathname);
    if (key !== prKey) {
      prKey = key;
      hidden = new Set();
      loaded = false;
      if (key) load(key);
      return;
    }
    if (!prKey || !loaded) return;

    const tables = fullScan
      ? document.querySelectorAll<HTMLElement>(site().diff)
      : [...pending].filter((table) => table.isConnected);
    fullScan = false;
    pending.clear();
    for (const table of tables) track(table, applyFile(table, hidden, settings.position)?.open);
    scheduleStickySoon();
  }

  function track(table: HTMLElement, open: OpenHunk[] | undefined): void {
    if (open?.length) files.set(table, open);
    else files.delete(table);
  }

  function scheduleSticky(): void {
    if (stickyScheduled) return;
    stickyScheduled = true;
    requestAnimationFrame(() => {
      stickyScheduled = false;
      if (settings.enabled && loaded) {
        sticky.update(files, settings.position);
        // While the mouse is still dragging out a selection, the button would chase the cursor.
        if (!pointerDown) selection.update(hidden);
      } else {
        sticky.hide();
        selection.hide();
      }
    });
  }

  // Rescans run on most frames while the site renders a big diff. The floating buttons measure
  // layout, which then forces the browser to lay out the whole page, so they catch up only once
  // the rescans settle; scrolling still updates them on every frame.
  let stickyTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleStickySoon(): void {
    if (stickyTimer) clearTimeout(stickyTimer);
    stickyTimer = setTimeout(() => {
      stickyTimer = null;
      scheduleSticky();
    }, STICKY_DELAY);
  }

  function load(key: string): void {
    store.load(key).then(
      (set) => {
        if (prKey !== key) return;
        hidden = set;
        loaded = true;
        fullScan = true;
        schedule();
      },
      (error: unknown) => {
        console.error('[diff-hunk-review] failed to load state', error);
        // Forget the PR so the next scan retries.
        if (prKey === key) prKey = null;
      },
    );
  }

  function onMutations(mutations: MutationRecord[]): void {
    if (!settings.enabled) return;
    const url = location.pathname + location.search;
    if (url !== lastUrl) {
      lastUrl = url;
      fullScan = true;
    }
    if (!site().prKey(location.pathname)) {
      pending.clear();
      return;
    }
    for (const mutation of mutations) collect(mutation);
    if (fullScan || pending.size) schedule();
  }

  function collect(mutation: MutationRecord): void {
    for (const node of mutation.removedNodes) {
      if (node instanceof Element && (node.matches('.ghr-progress') || node.querySelector('.ghr-progress'))) {
        fullScan = true;
      }
    }
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (!target) return;
    const table = target.closest<HTMLElement>(site().diff);
    if (!table) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(site().diff)) pending.add(node as HTMLElement);
        else for (const t of node.querySelectorAll<HTMLElement>(site().diff)) pending.add(t);
      }
      return;
    }
    if (target.closest('.ghr-toggle')) return;
    if (relevant(mutation, target, table)) pending.add(table);
  }

  function relevant(mutation: MutationRecord, target: Element, table: HTMLElement): boolean {
    if (mutation.type === 'attributes') return target === table || target.matches('code.diff-text');
    if (target.closest(site().content)) return true;
    if (mutation.type !== 'childList') return false;
    for (const node of mutation.removedNodes) {
      if (
        node instanceof Element &&
        (node.matches(`${site().rowNodes}, .ghr-toggle`) || node.querySelector(`${site().rowNodes}, .ghr-toggle`))
      ) {
        return true;
      }
    }
    for (const node of mutation.addedNodes) {
      if (node instanceof Element && (node.matches(site().rowNodes) || node.querySelector(site().rowNodes)))
        return true;
    }
    return false;
  }

  function toggle(button: HTMLButtonElement): void {
    const stuck = sticky.targetOf(button);
    const selected = selection.targetOf(button);
    const table = button.closest<HTMLElement>(site().diff) ?? stuck?.table ?? selected?.table ?? null;
    const keys = buttonKeys(button);
    const action = button.dataset.ghrAction === 'show' ? 'show' : 'hide';
    const key = prKey;
    if (!table || !keys.length || !key || !loaded || !settings.enabled) {
      // Logged so a dead button can be diagnosed from the console.
      console.warn('[diff-hunk-review] click ignored', {
        table: !!table,
        keys: keys.length,
        prKey: key,
        loaded,
        settings,
      });
      return;
    }
    const { changed, hunks, state } = toggleLines(table, keys, action, hidden, settings.position);
    track(table, state?.open);
    if (stuck) {
      sticky.hide();
      alignBelow(stuck.open.hunk.head, stuck.line);
    }
    if (selected) {
      selection.hide();
      document.getSelection()?.removeAllRanges();
    }
    scheduleSticky();
    if (!changed.length) return;
    // Only on the action that reviews the file's last hunk, so unticking Viewed by hand sticks.
    if (settings.autoViewed && action === 'hide' && hunks > 0 && state && state.reviewed === state.file.hunks.length) {
      markViewed(state.file.root);
    }

    const sign = action === 'hide' ? 1 : -1;
    const delta = { hunks, lines: sign * changed.length, files: 0 };
    store.record(delta).catch((error: unknown) => console.error('[diff-hunk-review] failed to record stats', error));
    writes++;
    store
      .update(key, action === 'hide' ? changed : [], action === 'hide' ? [] : changed)
      .catch((error: unknown) => {
        console.error('[diff-hunk-review] failed to save state', error);
        store.record({ hunks: -delta.hunks, lines: -delta.lines, files: 0 }).catch(() => {});
        if (prKey !== key) return;
        for (const k of changed) {
          if (action === 'hide') hidden.delete(k);
          else hidden.add(k);
        }
        files.clear();
        fullScan = true;
        schedule();
      })
      .finally(() => writes--);
  }

  function markViewed(root: HTMLElement): void {
    const control = site().viewedControl(root);
    if (!control || site().isChecked(control)) return;
    // Our own click isn't trusted, so the click listener won't count it; count the file here.
    viewedClicked(root, true);
    control.click();
  }

  function setPointerDown(down: boolean): void {
    pointerDown = down;
    if (down) selection.hide();
    else scheduleSticky();
  }

  // Another tab changed this PR; skipped while our own writes are in flight to avoid flicker.
  function onStoredChange(key: string, keys: Set<string>): void {
    if (key !== prKey || !loaded || writes) return;
    hidden = keys;
    fullScan = true;
    schedule();
  }

  function viewedClicked(root: HTMLElement, viewing: boolean): void {
    const key = prKey;
    const id = site().fileId(root);
    if (!key || !id || !loaded || !settings.enabled) return;
    const fail = (error: unknown) => console.error('[diff-hunk-review] failed to record Viewed', error);

    if (viewing) {
      const table = root.querySelector<HTMLElement>(site().diff);
      const counts: Counts = { ...(table ? unreviewed(table, hidden) : { hunks: 0, lines: 0 }), files: 1 };
      store
        .setViewed(key, id, counts)
        .then(() => store.record(counts))
        .catch(fail);
    } else {
      // Take back exactly what marking it added, even if the collapsed file isn't rendered.
      store
        .takeViewed(key, id)
        .then((counts) => counts && store.record({ hunks: -counts.hunks, lines: -counts.lines, files: -counts.files }))
        .catch(fail);
    }
  }

  function setSettings(next: Settings): void {
    const was = settings;
    settings = next;
    if (!next.enabled) {
      if (was.enabled) clearAll();
      files.clear();
      sticky.hide();
      selection.hide();
      return;
    }
    if (!was.enabled || was.position !== next.position) {
      fullScan = true;
      schedule();
    }
  }

  return {
    schedule,
    scan,
    onMutations,
    toggle,
    viewedClicked,
    onStoredChange,
    setSettings,
    setPointerDown,
    // Scrolling and selection changes move the floating buttons.
    onScroll: scheduleSticky,
    onResize() {
      sticky.invalidate();
      scheduleSticky();
    },
  };
}
