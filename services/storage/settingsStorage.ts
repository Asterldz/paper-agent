import type { AppSettings } from '@/types/settings';

const STORAGE_KEY = 'paper-agent:settings:v1';

export const DEFAULT_SETTINGS: AppSettings = {
  activeModelId: null,
  translationModelId: null,
  autoTranslate: true,
  translationLanguage: 'zh-CN',
  models: [],
};

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(value) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      models: Array.isArray(parsed.models) ? parsed.models : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
