export class LLMError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export function messageForStatus(status: number, model: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或无权访问，请检查模型设置。';
  if (status === 404) return `接口或模型 ${model} 不存在，请检查 Base URL 和模型名称。`;
  if (status === 429) return '请求过于频繁或 API 额度受限，请稍后重试。';
  if (status >= 500) return '模型服务暂时不可用，请稍后重试。';
  return `模型请求失败（HTTP ${status}），请检查配置。`;
}

export function readableLLMError(reason: unknown): string {
  if (reason instanceof LLMError) return reason.message;
  if (reason instanceof DOMException && reason.name === 'AbortError') return '请求已取消。';
  if (reason instanceof TypeError) return '网络请求失败。请检查 Base URL、网络连接及服务是否允许浏览器跨域访问。';
  return reason instanceof Error ? reason.message : '模型请求失败，请稍后重试。';
}
