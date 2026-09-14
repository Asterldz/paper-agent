'use client';

import { useState } from 'react';
import { readableLLMError } from '@/services/llm/errors';
import { testConnection } from '@/services/llm/testConnection';
import { OPENAI_COMPATIBLE_MAX_TOKENS } from '@/services/llm/openaiCompatible';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ModelConfig } from '@/types/settings';
import { clearAgentCache, getAgentCacheSize } from '@/services/storage/agentCache';
import { clearTermMemory, getTermMemorySize } from '@/services/storage/termMemory';
import { AgentEvolutionPanel } from '@/components/assistant/AgentControls';

function newModel(): ModelConfig {
  return {
    id: crypto.randomUUID(),
    name: '新模型',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    temperature: 0.2,
    maxTokens: 2048,
    translationThinkingMode: 'disabled',
    insightsThinkingMode: 'enabled',
    insightsReasoningEffort: 'low',
  };
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { models, activeModelId, translationModelId, saveModel, deleteModel, setActiveModel, setTranslationModel } = useSettingsStore();
  const initial = models.find((model) => model.id === activeModelId) ?? models[0] ?? newModel();
  const [draft, setDraft] = useState<ModelConfig>(initial);
  const [showKey, setShowKey] = useState(false);
  const [cacheSize, setCacheSize] = useState(() => getAgentCacheSize());
  const [termMemorySize, setTermMemorySize] = useState(() => getTermMemorySize());
  const [testState, setTestState] = useState<{ kind: 'idle' | 'testing' | 'success' | 'error'; message: string }>({ kind: 'idle', message: '' });

  const update = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTestState({ kind: 'idle', message: '' });
  };

  const chooseModel = (model: ModelConfig) => {
    setDraft(model);
    setTestState({ kind: 'idle', message: '' });
  };

  const handleSave = () => {
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) {
      setTestState({ kind: 'error', message: '请填写配置名称、Base URL 和模型名称。' });
      return;
    }
    saveModel({
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      maxTokens: draft.maxTokens === undefined
        ? undefined
        : Math.min(Math.max(1, Math.floor(draft.maxTokens)), OPENAI_COMPATIBLE_MAX_TOKENS),
    });
    setActiveModel(draft.id);
    setTestState({ kind: 'success', message: '模型配置已保存在当前浏览器。' });
  };

  const handleTest = async () => {
    setTestState({ kind: 'testing', message: '正在连接模型…' });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      await testConnection(draft, controller.signal);
      setTestState({ kind: 'success', message: '连接成功，可以开始翻译。' });
    } catch (reason: unknown) {
      setTestState({ kind: 'error', message: readableLLMError(reason) });
    } finally {
      window.clearTimeout(timeout);
    }
  };

  return (
    <div aria-modal="true" className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <div className="settings-dialog">
        <header className="flex h-14 items-center justify-between border-b border-[#e4e6ea] px-5">
          <div><h2 className="text-sm font-semibold">模型与 Agent 设置</h2><p className="mt-0.5 text-xs text-[#969ca6]">文献助手使用 LangGraph · 模型需支持工具调用</p></div>
          <button aria-label="关闭设置" className="icon-button" onClick={onClose} type="button">×</button>
        </header>

        <div className="settings-body">
          <aside className="settings-sidebar">
            <div className="mb-3 flex items-center justify-between"><p className="eyebrow">MODELS</p><button aria-label="添加模型" className="icon-button" onClick={() => chooseModel(newModel())} type="button">＋</button></div>
            <div className="space-y-1">
              {models.map((model) => (
                <button className={`model-list-item ${draft.id === model.id ? 'model-list-item-active' : ''}`} key={model.id} onClick={() => chooseModel(model)} type="button">
                  <span className={`h-2 w-2 rounded-full ${model.id === activeModelId ? 'bg-[#3157d5]' : 'bg-[#c5c9d0]'}`} />
                  <span className="min-w-0 flex-1 truncate text-left">{model.name}</span>
                </button>
              ))}
              {!models.length ? <p className="px-2 py-3 text-xs leading-5 text-[#9a9fa9]">尚未添加模型。填写右侧配置并保存。</p> : null}
            </div>
          </aside>

          <form className="min-w-0 overflow-auto p-6" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="配置名称"><input className="settings-input" onChange={(event) => update('name', event.target.value)} placeholder="例如 DeepSeek" value={draft.name} /></Field>
              <Field label="Provider"><input className="settings-input bg-[#f7f8fa] text-[#777e8a]" disabled value="OpenAI Compatible" /></Field>
              <div className="sm:col-span-2"><Field label="Base URL"><input className="settings-input" onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} value={draft.baseUrl} /></Field></div>
              <div className="sm:col-span-2"><Field label="API Key"><div className="relative"><input autoComplete="off" className="settings-input pr-14" onChange={(event) => update('apiKey', event.target.value)} placeholder="sk-…（本地模型可留空）" spellCheck={false} type={showKey ? 'text' : 'password'} value={draft.apiKey} /><button className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#777e8a]" onClick={() => setShowKey((value) => !value)} type="button">{showKey ? '隐藏' : '显示'}</button></div></Field></div>
              <div className="sm:col-span-2"><Field label="Model"><input className="settings-input" onChange={(event) => update('model', event.target.value)} placeholder="例如 deepseek-chat" spellCheck={false} value={draft.model} /></Field></div>
              <Field label="Temperature"><input className="settings-input" max="2" min="0" onChange={(event) => update('temperature', Number(event.target.value))} step="0.1" type="number" value={draft.temperature} /></Field>
              <Field label="Max Tokens"><input className="settings-input" max={OPENAI_COMPATIBLE_MAX_TOKENS} min="1" onChange={(event) => update('maxTokens', Number(event.target.value) || undefined)} type="number" value={draft.maxTokens ?? ''} /></Field>
            </div>

            <div className="mt-5 rounded-lg bg-[#f7f8fa] px-3 py-2.5 text-[11px] leading-5 text-[#7d838e]">
              <div className="flex items-center justify-between gap-4"><span>API Key、译文缓存和术语记忆仅保存在当前设备。重复内容会直接复用，减少 API 调用。</span><button className="shrink-0 font-medium text-[#4d64ad]" disabled={!cacheSize && !termMemorySize} onClick={() => { clearAgentCache(); clearTermMemory(); setCacheSize(0); setTermMemorySize(0); }} type="button">清除（译文 {cacheSize} · 术语 {termMemorySize}）</button></div>
            </div>
            <div className="mt-3 rounded-lg border border-[#e5e8ef] px-3 py-3">
              <label className="flex items-center justify-between gap-4 text-[11px] text-[#626975]"><span><strong className="block font-medium text-[#424852]">快速翻译模型</strong><span className="mt-0.5 block text-[#9298a2]">可选择更小、更快的模型；解释和分析仍使用当前模型。</span></span><select className="settings-input w-44 shrink-0" onChange={(event) => setTranslationModel(event.target.value || null)} value={translationModelId ?? ''}><option value="">跟随当前模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
            </div>
            <div className="mt-3 rounded-lg border border-[#e5e8ef] px-3 py-3">
              <div className="mb-3"><strong className="block text-[11px] font-medium text-[#424852]">思考模式</strong><span className="mt-0.5 block text-[10px] leading-4 text-[#9298a2]">参数不受当前接口支持时会自动退回模型默认设置。</span></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="翻译">
                  <select className="settings-input" onChange={(event) => update('translationThinkingMode', event.target.value as ModelConfig['translationThinkingMode'])} value={draft.translationThinkingMode ?? 'disabled'}>
                    <option value="disabled">关闭（推荐）</option><option value="auto">模型默认</option><option value="enabled">开启</option>
                  </select>
                </Field>
                <Field label="术语与延伸">
                  <select className="settings-input" onChange={(event) => update('insightsThinkingMode', event.target.value as ModelConfig['insightsThinkingMode'])} value={draft.insightsThinkingMode ?? 'enabled'}>
                    <option value="enabled">开启（推荐）</option><option value="auto">模型默认</option><option value="disabled">关闭</option>
                  </select>
                </Field>
                {(draft.insightsThinkingMode ?? 'enabled') === 'enabled' ? <Field label="术语思考强度">
                  <select className="settings-input" onChange={(event) => update('insightsReasoningEffort', event.target.value as ModelConfig['insightsReasoningEffort'])} value={draft.insightsReasoningEffort ?? 'low'}>
                    <option value="low">Low（推荐）</option><option value="high">High</option><option value="max">Max</option>
                  </select>
                </Field> : null}
              </div>
            </div>
            {testState.kind !== 'idle' ? <p className={`mt-3 text-xs ${testState.kind === 'error' ? 'text-red-600' : testState.kind === 'success' ? 'text-emerald-700' : 'text-[#777e8a]'}`}>{testState.message}</p> : null}

            <AgentEvolutionPanel />

            <footer className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#eceef1] pt-5">
              <button className="toolbar-button" disabled={testState.kind === 'testing'} onClick={() => void handleTest()} type="button">{testState.kind === 'testing' ? '测试中…' : '测试连接'}</button>
              <button className="primary-button" type="submit">保存并启用</button>
              {models.some((model) => model.id === draft.id) ? <button className="ml-auto text-xs text-red-600" onClick={() => { deleteModel(draft.id); chooseModel(newModel()); }} type="button">删除</button> : null}
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#666d78]">{label}</span>{children}</label>;
}
