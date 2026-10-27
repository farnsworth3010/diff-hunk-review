export type ButtonPosition = 'left' | 'right';

export interface Settings {
  enabled: boolean;
  position: ButtonPosition;
  // Tick the site's own Viewed checkbox once every hunk of a file is reviewed.
  autoViewed: boolean;
}

export const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS: Settings = { enabled: true, position: 'left', autoViewed: true };

export function parseSettings(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Settings>;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    position: raw.position === 'right' ? 'right' : 'left',
    autoViewed: typeof raw.autoViewed === 'boolean' ? raw.autoViewed : DEFAULT_SETTINGS.autoViewed,
  };
}

// Settings live in sync storage so they follow the user across devices.
export async function loadSettings(): Promise<Settings> {
  return parseSettings((await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

export function saveSettings(settings: Settings): Promise<void> {
  return chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}
