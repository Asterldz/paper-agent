export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  translationThinkingMode?: 'auto' | 'enabled' | 'disabled';
  insightsThinkingMode?: 'auto' | 'enabled' | 'disabled';
  insightsReasoningEffort?: 'low' | 'high' | 'max';
}

export interface AppSettings {
  activeModelId: string | null;
  translationModelId: string | null;
  autoTranslate: boolean;
  translationLanguage: 'zh-CN';
  models: ModelConfig[];
}
