'use client';

import { useAgentStore, type AgentMetrics } from '@/stores/agentStore';
import { useInsightsStore } from '@/stores/insightsStore';
import { useReaderStore } from '@/stores/readerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AgentAction } from '@/types/agent';

export function TranslationPanel({ onAction, onScaleChange, scale }: {
  onAction: (action: AgentAction) => void;
  onScaleChange: (scale: number) => void;
  scale: number;
}) {
  const activeSelection = useReaderStore((state) => state.activeSelection);
  const { output, isLoading, error, currentAction, fromCache, metrics } = useAgentStore();
  const insights = useInsightsStore();
  const { activeModelId, translationModelId, models } = useSettingsStore();
  const activeModel = models.find((model) => model.id === (currentAction === 'translate' ? translationModelId ?? activeModelId : activeModelId))
    ?? models.find((model) => model.id === activeModelId);
  const actionLabels: Record<AgentAction, string> = { translate: '译文', explain: '解读', summarize: '摘要', term: '术语', ask: '回答' };

  return (
    <aside className="translation-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
      <nav aria-label="阅读辅助面板" className="flex h-12 shrink-0 items-end gap-7 border-b border-[#dedbd3] px-6">
        <button className={`panel-tab ${currentAction === 'translate' || !currentAction ? 'panel-tab-active' : ''}`} disabled={!activeSelection} onClick={() => onAction('translate')} type="button">翻译</button>
        <button className={`panel-tab ${currentAction === 'explain' ? 'panel-tab-active' : ''}`} disabled={!activeSelection} onClick={() => onAction('explain')} type="button">解释</button>
        <div className="panel-scale-control mb-2 ml-auto flex items-center gap-1" aria-label="右侧内容缩放">
          <button aria-label="缩小右侧内容" disabled={scale <= 0.8} onClick={() => onScaleChange(scale - 0.1)} type="button">−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button aria-label="放大右侧内容" disabled={scale >= 1.4} onClick={() => onScaleChange(scale + 0.1)} type="button">＋</button>
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-7 sm:py-8">
        <div style={{ zoom: scale }}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><h2 className="text-[15px] font-semibold text-[#303238]">翻译与解释</h2><p className="mt-1 text-[10px] text-[#92959c]">基于当前划选内容</p></div>
          <StatusBadge action={currentAction} fromCache={fromCache} hasSelection={Boolean(activeSelection)} isLoading={isLoading} />
        </div>

        {!activeSelection ? <EmptyTranslation /> : (
          <div className="space-y-5">
            <section aria-live="polite" className="translation-sheet min-h-40">
              <div className="mb-4 flex items-center justify-between border-b border-[#e8e4db] pb-3"><p className="section-kicker">{currentAction ? actionLabels[currentAction] : '译文'} <span className="mx-1.5 text-[#c4bfb5]">/</span> {activeModel?.name ?? '未配置模型'}</p>{isLoading ? <span className="text-[11px] text-[#73736d]">处理中</span> : null}</div>
              {error ? <p className="text-sm leading-7 text-red-600">{error}</p> : (
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#30353d]">{output || `正在准备${currentAction ? actionLabels[currentAction] : '译文'}…`}{isLoading && output ? <span className="stream-caret" /> : null}</p>
              )}
            </section>
            {currentAction === 'translate' && metrics ? <TranslationTiming metrics={metrics} /> : null}

            <div className="flex flex-wrap gap-2 border-t border-[#e5e1d8] pt-5">
              <button className="action-chip" onClick={() => onAction('translate')} type="button">翻译</button><button className="action-chip" onClick={() => onAction('explain')} type="button">解释</button><button className="action-chip" onClick={() => onAction('summarize')} type="button">总结</button><button className="action-chip" onClick={() => onAction('term')} type="button">术语</button>
            </div>
          </div>
        )}

        {activeSelection ? <InsightsSection error={insights.error} fromCache={insights.fromCache} output={insights.output} status={insights.status} /> : null}
        </div>
      </div>
    </aside>
  );
}

function TranslationTiming({ metrics }: { metrics: AgentMetrics }) {
  return (
    <div className="response-metrics" title="数据只在当前设备中计算">
      <span>划选处理 {formatDuration(metrics.selectionProcessingMs)}</span>
      <span>缓存查询 {formatDuration(metrics.cacheLookupMs)}</span>
      <span>首字 {metrics.firstTokenMs === null ? '—' : formatDuration(metrics.firstTokenMs)}</span>
      <span>完成 {metrics.totalMs === null ? '—' : formatDuration(metrics.totalMs)}</span>
      {metrics.segmentCount > 1 ? <span>分段 {metrics.cachedSegments}/{metrics.segmentCount} 命中</span> : null}
      {metrics.termHits > 0 ? <span>术语命中 {metrics.termHits}</span> : null}
    </div>
  );
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function InsightsSection({ error, fromCache, output, status }: {
  error: string | null;
  fromCache: boolean;
  output: string;
  status: 'idle' | 'queued' | 'loading' | 'ready' | 'error';
}) {
  return (
    <section className="mt-8 border-t border-[#e5e1d8] pt-6" aria-live="polite">
      <div className="flex items-center justify-between">
        <div><h3 className="text-[13px] font-semibold text-[#36383d]">术语与延伸</h3><p className="mt-1 text-[10px] text-[#9699a0]">帮助理解当前段落</p></div>
        {status === 'loading' ? <span className="text-[10px] font-medium text-[#6f7fae]">分析中</span> : null}
        {status === 'ready' && fromCache ? <span className="text-[10px] font-medium text-emerald-700">本地缓存</span> : null}
      </div>
      <div className="insights-note mt-4 px-4 py-4">
        {error ? <p className="text-xs leading-6 text-red-600">{error}</p> : null}
        {!error && output ? <p className="whitespace-pre-wrap text-[12px] leading-6 text-[#505762]">{output}{status === 'loading' ? <span className="stream-caret" /> : null}</p> : null}
        {!error && !output ? <p className="text-xs leading-6 text-[#949aa5]">{status === 'queued' ? '译文生成后，将自动提取术语并补充理解线索。' : '划选内容后自动生成相关概念。'}</p> : null}
      </div>
    </section>
  );
}

function StatusBadge({ action, fromCache, hasSelection, isLoading }: { action: AgentAction | null; fromCache: boolean; hasSelection: boolean; isLoading: boolean }) {
  const loadingLabels: Partial<Record<AgentAction, string>> = { translate: '正在翻译', explain: '正在解释', summarize: '正在总结', term: '正在分析术语' };
  const label = isLoading ? (action ? loadingLabels[action] ?? '正在生成' : '正在生成') : fromCache ? '本地缓存' : hasSelection ? '选区已捕获' : '等待划选';
  return <span className={`status-label ${hasSelection ? 'status-label-active' : ''}`}><i />{label}</span>;
}

function EmptyTranslation() {
  return (
    <div className="empty-note grid min-h-52 place-items-center px-7 text-center">
      <div><p className="text-sm font-medium text-[#575a61]">在左侧划选原文</p><p className="mt-2 text-xs leading-5 text-[#92959c]">这里会显示译文、解释与相关术语。</p></div>
    </div>
  );
}
