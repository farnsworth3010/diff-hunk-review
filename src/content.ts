import { createController } from './controller';
import { clearAll } from './review';
import { DEFAULT_SETTINGS, loadSettings, parseSettings, SETTINGS_KEY } from './settings';
import { site } from './sites';
import { recordReview } from './stats';
import { loadHidden, parseStored, pruneStale, setViewed, takeViewed, updateHidden } from './storage';

const controller = createController({
  load: loadHidden,
  update: updateHidden,
  record: recordReview,
  setViewed,
  takeViewed,
});

// After the extension is reloaded or updated, Chrome leaves this script running in open tabs
// without chrome.* access, and doesn't inject the new one until the page reloads.
const alive = () => Boolean(chrome.runtime?.id);

// Returns false, after removing everything and asking for a reload, once the script is dead.
function checkAlive(): boolean {
  if (alive()) return true;
  teardown();
  return false;
}

const observer = new MutationObserver((mutations) => {
  if (checkAlive()) controller.onMutations(mutations);
});

const toggleButton = (event: Event) =>
  event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button.ghr-toggle') : null;

// Keep GitHub's grid handlers (cell focus, line selection) from reacting to presses on our button.
// mousedown's default is cancelled too, so the cell doesn't take focus and re-render under the pointer.
const swallow = (event: Event) => {
  if (!toggleButton(event)) return;
  event.stopPropagation();
  if (event.type === 'mousedown') event.preventDefault();
};
const SWALLOWED = ['pointerup', 'mousedown', 'mouseup', 'keydown'] as const;

// Mouse presses toggle on pointerdown: a click needs press and release on the same element,
// and GitHub re-rendering the row in between would swallow it.
const onPointerDown = (event: PointerEvent) => {
  const button = toggleButton(event);
  if (!button) {
    if (event.button === 0) controller.setPointerDown(true);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!checkAlive()) return;
  // Ignore events synthesized by page scripts.
  if (event.isTrusted && event.button === 0) controller.toggle(button);
};

const onClick = (event: MouseEvent) => {
  // The site's own Viewed checkbox: only observed, the click goes through untouched.
  const viewed = site().viewedClick(event.target);
  if (viewed && event.isTrusted) controller.viewedClicked(viewed.root, viewed.viewing);
  const button = toggleButton(event);
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (!checkAlive()) return;
  // Keyboard activation (Enter/Space) arrives as a click with detail 0; mouse clicks were handled on pointerdown.
  if (event.isTrusted && event.detail === 0) controller.toggle(button);
};

const onScroll = () => controller.onScroll();
const onResize = () => controller.onResize();
// A tab left in the background through an extension reload finds out as soon as it is shown.
const onVisible = () => {
  if (document.visibilityState === 'visible') checkAlive();
};
const onPointerUp = () => controller.setPointerDown(false);

const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area === 'sync' && SETTINGS_KEY in changes) controller.setSettings(parseSettings(changes[SETTINGS_KEY].newValue));
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) controller.onStoredChange(key, parseStored(change.newValue));
};

let tornDown = false;

// Buttons of a dead script can't do anything, so they are removed instead of left on the page.
function teardown(): void {
  if (tornDown) return;
  tornDown = true;
  observer.disconnect();
  for (const type of SWALLOWED) document.removeEventListener(type, swallow, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('scroll', onScroll, true);
  document.removeEventListener('selectionchange', onScroll);
  document.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('resize', onResize);
  const hadButtons = !!document.querySelector('.ghr-toggle');
  clearAll();
  if (hadButtons) showReloadNotice();
}

// Styled inline: the extension's stylesheet may be gone along with the old script.
function showReloadNotice(): void {
  const notice = document.createElement('div');
  notice.className = 'ghr-toast';
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    border: '1px solid #d1d9e0',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#1f2328',
    boxShadow: '0 8px 24px rgba(31, 35, 40, 0.2)',
    font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  const text = document.createElement('span');
  text.textContent = 'Hunk Review was updated. Reload this page to keep reviewing.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload page';
  Object.assign(reload.style, {
    padding: '4px 10px',
    border: '1px solid #1f883d',
    borderRadius: '6px',
    background: '#1f883d',
    color: '#ffffff',
    font: 'inherit',
    cursor: 'pointer',
  });
  reload.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  Object.assign(close.style, { border: '0', background: 'none', color: '#59636e', font: 'inherit', cursor: 'pointer' });
  close.addEventListener('click', () => notice.remove());
  notice.append(text, reload, close);
  document.body.append(notice);
}

// Settings load first, so a disabled extension never flashes its buttons.
loadSettings()
  .catch((error: unknown) => {
    console.error('[diff-hunk-review] failed to load settings', error);
    return DEFAULT_SETTINGS;
  })
  .then((settings) => {
    controller.setSettings(settings);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label'],
    });
    for (const type of SWALLOWED) document.addEventListener(type, swallow, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    // Capture catches scrolling of any container, not only the window.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('selectionchange', onScroll);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('visibilitychange', onVisible);
    chrome.storage.onChanged.addListener(onStorageChanged);
    controller.schedule();
  });
pruneStale().catch((error: unknown) => console.error('[diff-hunk-review] failed to prune storage', error));
