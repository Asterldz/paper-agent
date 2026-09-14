'use client';

import { create } from 'zustand';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/services/storage/settingsStorage';
import type { AppSettings, ModelConfig } from '@/types/settings';

interface SettingsState extends AppSettings {
  hydrated: boolean;
  hydrate: () => void;
  saveModel: (model: ModelConfig) => void;
  deleteModel: (id: string) => void;
  setActiveModel: (id: string) => void;
  setTranslationModel: (id: string | null) => void;
  setAutoTranslate: (enabled: boolean) => void;
}

function persist(state: SettingsState) {
  saveSettings({
    activeModelId: state.activeModelId,
    translationModelId: state.translationModelId,
    autoTranslate: state.autoTranslate,
    translationLanguage: state.translationLanguage,
    models: state.models,
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,
  hydrate: () => set({ ...loadSettings(), hydrated: true }),
  saveModel: (model) => {
    set((state) => ({
      models: state.models.some((item) => item.id === model.id)
        ? state.models.map((item) => item.id === model.id ? model : item)
        : [...state.models, model],
      activeModelId: state.activeModelId ?? model.id,
    }));
    persist(get());
  },
  deleteModel: (id) => {
    set((state) => {
      const models = state.models.filter((item) => item.id !== id);
      return {
        models,
        activeModelId: state.activeModelId === id ? models[0]?.id ?? null : state.activeModelId,
        translationModelId: state.translationModelId === id ? null : state.translationModelId,
      };
    });
    persist(get());
  },
  setActiveModel: (activeModelId) => { set({ activeModelId }); persist(get()); },
  setTranslationModel: (translationModelId) => { set({ translationModelId }); persist(get()); },
  setAutoTranslate: (autoTranslate) => { set({ autoTranslate }); persist(get()); },
}));
