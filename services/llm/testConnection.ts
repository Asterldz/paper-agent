import { createProvider } from './providerFactory';
import type { ModelConfig } from '@/types/settings';

export async function testConnection(config: ModelConfig, signal: AbortSignal): Promise<void> {
  if (!config.model.trim()) throw new Error('请填写模型名称。');
  let response = '';
  const provider = createProvider({ ...config, maxTokens: 8, temperature: 0 });
  for await (const chunk of provider.chat([{ role: 'user', content: 'Respond with OK.' }], { signal })) {
    response += chunk;
    if (response.length > 20) break;
  }
  if (!response.trim()) throw new Error('模型返回了空响应。');
}
