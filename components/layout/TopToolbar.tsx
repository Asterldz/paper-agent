'use client';

import type { ModelConfig } from '@/types/settings';

interface TopToolbarProps {
  autoTranslate: boolean;
  currentPage: number;
  fileName: string;
  historyCount: number;
  referenceCount: number;
  totalPages: number;
  zoom: number;
  activeModelId: string | null;
  models: ModelConfig[];
  onAutoTranslateChange: () => void;
  onNavigate: (page: number) => void;
  onOpen: () => void;
  onOpenConverter: () => void;
  onOpenHistory: () => void;
  onOpenReferences: () => void;
  onOpenSettings: () => void;
  onSelectModel: (id: string) => void;
  onZoomChange: (zoom: number) => void;
}

export function TopToolbar(props: TopToolbarProps) {
  const hasDocument = props.totalPages > 0;
  return (
    <header className="app-toolbar flex h-16 shrink-0 items-center gap-3 px-5">
      <div className="paper-brand flex min-w-0 items-center gap-3">
        <div className="paper-mark">P</div>
        <div className="hidden leading-tight sm:block"><div className="text-[13px] font-semibold text-[#303238]">Paper Agent</div><div className="mt-0.5 text-[9px] text-[#92959c]">文献阅读</div></div>
      </div>
      <div className="mx-1 h-6 w-px bg-[#d9d5cc]" />
      <button className="toolbar-button toolbar-button-primary" onClick={props.onOpen} type="button">导入文献</button>
      <button className="toolbar-button" onClick={props.onOpenHistory} type="button"><span className="hidden sm:inline">文献库</span>{props.historyCount ? <span className="history-count">{props.historyCount}</span> : null}</button>
      <button className="toolbar-button" disabled={!hasDocument} onClick={props.onOpenReferences} type="button"><span className="hidden lg:inline">参考文献</span>{props.referenceCount ? <span className="history-count">{props.referenceCount}</span> : null}</button>
      <button className="toolbar-button" disabled={!hasDocument} onClick={props.onOpenConverter} type="button"><span className="hidden sm:inline">转换</span></button>
      <div className="document-title min-w-0 flex-1"><p className="truncate text-center text-[11px] text-[#77756f]">{props.fileName || '尚未打开文献'}</p></div>
      <div className="hidden items-center gap-1 md:flex">
        <button aria-label="上一页" className="icon-button" disabled={!hasDocument || props.currentPage <= 1} onClick={() => props.onNavigate(props.currentPage - 1)} type="button">‹</button>
        <span className="w-16 text-center text-xs tabular-nums text-[#777e8a]">{hasDocument ? `${props.currentPage} / ${props.totalPages}` : '— / —'}</span>
        <button aria-label="下一页" className="icon-button" disabled={!hasDocument || props.currentPage >= props.totalPages} onClick={() => props.onNavigate(props.currentPage + 1)} type="button">›</button>
      </div>
      <div className="zoom-control hidden items-center gap-1 p-1 md:flex">
        <button aria-label="缩小" className="icon-button" disabled={!hasDocument || props.zoom <= 0.6} onClick={() => props.onZoomChange(props.zoom - 0.1)} type="button">−</button>
        <span className="w-12 text-center text-xs tabular-nums text-[#777e8a]">{Math.round(props.zoom * 100)}%</span>
        <button aria-label="放大" className="icon-button" disabled={!hasDocument || props.zoom >= 2.25} onClick={() => props.onZoomChange(props.zoom + 0.1)} type="button">＋</button>
      </div>
      {props.models.length ? (
        <label className="model-button">
          <span className="model-indicator" />
          <select aria-label="当前模型" className="max-w-32 bg-transparent text-xs outline-none" onChange={(event) => props.onSelectModel(event.target.value)} value={props.activeModelId ?? props.models[0].id}>
            {props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
      ) : <button className="model-button" onClick={props.onOpenSettings} type="button"><span className="model-indicator model-indicator-idle" /><span className="max-w-28 truncate">配置模型</span></button>}
      <label className="hidden cursor-pointer items-center gap-2 text-xs text-[#575d68] lg:flex">
        <button aria-pressed={props.autoTranslate} className={`switch ${props.autoTranslate ? 'switch-on' : ''}`} onClick={props.onAutoTranslateChange} type="button"><span /></button>自动翻译
      </label>
      <button aria-label="模型设置" className="settings-button" onClick={props.onOpenSettings} type="button">设置</button>
    </header>
  );
}
