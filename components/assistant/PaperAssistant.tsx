'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePaperAssistant } from '@/hooks/usePaperAssistant';
import { usePaperChatStore } from '@/stores/paperChatStore';
import { useReaderStore } from '@/stores/readerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { AgentEvolutionPanel, AgentRunDetails } from './AgentControls';
import type { EvidenceSource } from '@/types/agentRuntime';
import { WikiPanel } from './WikiPanel';
import { loadWiki, WIKI_CHANGED } from '@/services/storage/wikiLibrary';
import { useAssistantFloat } from '@/hooks/useAssistantFloat';
import { PetSprite } from './PetSprite';

const summaryPrompt = '请总结当前整篇论文，按“研究问题、核心方法、实验或数据、主要结果、局限”组织，并引用对应页码。';

export function PaperAssistant({ activeDocumentId, onNavigate, onOpenReferences, onOpenSettings, onOpenDocument, referenceCount }: {
  activeDocumentId: string | null;
  onNavigate: (page: number) => void;
  onOpenReference: (referenceNumber: number, page?: number) => void;
  onOpenReferences: () => void;
  onOpenSettings: () => void;
  onOpenDocument: (id: string, page: number) => void;
  referenceCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiCount, setWikiCount] = useState(0);
  const [wikiDrafts, setWikiDrafts] = useState(0);
  const floating = useAssistantFloat();
  const [petReaction, setPetReaction] = useState<'idle' | 'landing' | 'hello'>('idle');
  const [reactionId, setReactionId] = useState(0);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishPetReaction = useCallback(() => setPetReaction('idle'), []);
  const { ask, cancel } = usePaperAssistant(activeDocumentId);
  const { messages, isLoading, error, agentStatus, evidencePages, reset } = usePaperChatStore();
  const { documentPages, fileName, isIndexing, totalPages } = useReaderStore();
  const { activeModelId } = useSettingsStore();
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    const sync = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('paper-pet-animation-enabled'); } catch { /* Use system preference. */ }
      if (!disposed) setMotionEnabled(saved === null ? !media.matches : saved === 'true');
    };
    queueMicrotask(sync); media.addEventListener('change', sync);
    return () => { disposed = true; media.removeEventListener('change', sync); };
  }, []);
  const toggleMotion = () => {
    const next = !motionEnabled; setMotionEnabled(next);
    try { localStorage.setItem('paper-pet-animation-enabled', String(next)); } catch { /* Session choice still applies. */ }
  };
  useEffect(() => {
    let active = true;
    const update = () => { void loadWiki().then((state) => { if (active) { setWikiCount(state.pages.length); setWikiDrafts(state.drafts.filter((item) => item.status === 'pending').length); } }).catch(() => {}); };
    update(); window.addEventListener(WIKI_CHANGED, update); window.addEventListener('focus', update);
    return () => { active = false; window.removeEventListener(WIKI_CHANGED, update); window.removeEventListener('focus', update); };
  }, []);

  useEffect(() => reset(fileName || undefined), [activeDocumentId, fileName, reset]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, error]);
  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 120); }, [open]);
  const showPetReaction = (reaction: 'hello' | 'landing' = 'hello') => {
    setPetReaction(reaction);
    setReactionId((id) => id + 1);
  };

  const handlePetClick = () => {
    if (!floating.toggleAllowed()) return;
    setOpen((value) => !value);
    showPetReaction();
  };

  const submit = (question: string) => {
    const value = question.trim();
    if (!value || isLoading) return;
    if (!activeModelId) { onOpenSettings(); return; }
    setInput('');
    void ask(value);
  };

  const ready = documentPages.length > 0;
  const petMotion = floating.petCarried ? 'carried' : petReaction !== 'idle' ? petReaction : isLoading ? 'thinking' : 'idle';
  const petEvents = floating.events('pet');
  const canAsk = ready || wikiCount > 0;
  const openSource = (source: EvidenceSource) => {
    if (source.url) {
      try {
        const url = new URL(source.url);
        if (url.protocol === 'https:' && ['doi.org', 'europepmc.org', 'arxiv.org'].includes(url.hostname)) window.open(url.toString(), '_blank', 'noopener,noreferrer');
      } catch { /* Old or invalid source links must not navigate the local reader. */ }
      return;
    }
    if (source.documentId === (activeDocumentId ?? 'current-document')) onNavigate(source.pageNumber);
    else onOpenDocument(source.documentId, source.pageNumber);
  };
  const indexMessage = isIndexing
    ? `正在阅读并建立全文索引（共 ${totalPages} 页）…`
    : totalPages > 0 && !ready
      ? '没有发现可提取的文字，扫描版 PDF 需要 OCR。'
      : '请先打开一篇 PDF。';

  return (
    <>
      {wikiOpen ? <WikiPanel onClose={() => setWikiOpen(false)} onAsk={submit} onSource={(source) => { if (!source.url) setWikiOpen(false); openSource(source); }} busy={isLoading} currentReady={ready && !isIndexing} /> : null}
      {open ? (
        <section aria-label="论文 AI 助手" className={`paper-assistant-window paper-assistant-floating ${floating.dragging ? 'is-moving' : ''}`} style={floating.layout ? { left: floating.layout.panel.x, top: floating.layout.panel.y, width: floating.layout.panel.width, height: floating.layout.panel.height, right: 'auto', bottom: 'auto' } : undefined}>
          <header {...floating.events('panel')} className="assistant-drag-header flex items-center gap-3 border-b border-[#e1e3e7] bg-white px-4 py-3" title="按住标题栏移动窗口与宠物">
            <AssistantMark />
            <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-[#34363b]">文献助手</h2><p className="truncate text-xs text-[#92959c]">LangGraph · {fileName || (wikiCount ? '知识库问答' : '等待打开文献')}</p></div>
            <button className="toolbar-button" onClick={() => setWikiOpen(true)} type="button">知识库{wikiDrafts ? ` · ${wikiDrafts} 待审` : ''}</button>
            <button aria-label="关闭论文助手" className="icon-button" onClick={() => setOpen(false)} type="button">×</button>
          </header>
          <div className="assistant-window-tools"><span>拖动边缘调整大小</span><button type="button" aria-pressed={motionEnabled} title="宠物逐帧动画；默认遵循系统减少动态效果设置" onClick={toggleMotion}>动作：{motionEnabled ? '开' : '关'}</button><button type="button" aria-label="缩小对话窗口" onClick={() => floating.resizeBy(-60)}>−</button><button type="button" aria-label="放大对话窗口" onClick={() => floating.resizeBy(60)}>＋</button><button type="button" onClick={floating.resetSize}>复位</button></div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#f5f6f7] p-4">
            {!ready && !wikiCount ? <div className="rounded-xl border border-dashed border-[#dce1eb] bg-white px-4 py-4 text-xs leading-5 text-[#7c838f]">{indexMessage}</div> : null}
            {messages.map((message) => (
              <div className={`flex items-start gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`} key={message.id}>
                {message.role === 'assistant' ? <span className="assistant-message-mark"><AssistantMark compact /></span> : null}
                <div className={`paper-chat-bubble ${message.role === 'user' ? 'paper-chat-user' : 'paper-chat-assistant'}`}>
                  {message.content ? <MessageContent content={message.content} sources={message.report?.sources} onSource={openSource} /> : <ThinkingDots />}
                  {message.report ? <AgentRunDetails report={message.report} onSource={openSource} /> : null}
                </div>
              </div>
            ))}
            {isLoading && agentStatus ? (
              <div className="agent-trace-card">
                <span className="agent-trace-dot" />
                <span className="min-w-0 flex-1">{agentStatus}</span>
                {evidencePages.slice(0, 5).map((page) => <button key={page} onClick={() => onNavigate(page)} type="button">P{page}</button>)}
              </div>
            ) : null}
            {error ? <div className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs leading-5 text-red-600">{error}</div> : null}
          </div>

          <div className="max-h-[45%] shrink-0 overflow-auto">
          <AgentEvolutionPanel runId={messages.filter((message) => message.report).at(-1)?.id} />
          <div className="border-t border-[#e1e3e7] bg-white p-3">
            {ready ? <div className="mb-2 flex gap-2 overflow-x-auto pb-0.5"><button className="assistant-suggestion" disabled={isLoading} onClick={() => submit(summaryPrompt)} type="button">总结整篇</button><button className="assistant-suggestion" disabled={isLoading} onClick={() => submit('这篇论文的核心方法是什么？请引用页码。')} type="button">核心方法</button><button className="assistant-suggestion" disabled={isLoading} onClick={() => submit('论文有哪些主要结论和局限？请引用页码。')} type="button">结论与局限</button>{referenceCount ? <button className="assistant-suggestion" onClick={onOpenReferences} type="button">参考文献 {referenceCount}</button> : null}</div> : null}
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); submit(input); }}>
              <input ref={inputRef} className="min-w-0 flex-1 rounded-[3px] border border-[#d8d3c9] bg-[#fffefa] px-3 text-xs outline-none focus:border-[#6d837c]" disabled={!canAsk} onChange={(event) => setInput(event.target.value)} placeholder={canAsk ? '询问文献，或整理到知识库…' : '打开文献后可提问'} value={input} />
              {isLoading ? <button className="assistant-send assistant-stop" onClick={cancel} type="button">停止</button> : <button className="assistant-send" disabled={!canAsk || !input.trim()} type="submit">发送</button>}
            </form>
            {!activeModelId ? <button className="mt-2 text-xs font-medium text-[#4b63b0]" onClick={onOpenSettings} type="button">需要先配置分析模型 →</button> : <p className="mt-2 text-xs leading-4 text-[#858b95]">优先读当前论文，按需检索外部文献与开放全文。检索会发送题名或关键词；点击来源可核对全文或摘要。</p>}
          </div>
          </div>
          {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((edge) => <div key={edge} aria-hidden="true" className={`assistant-resize assistant-resize-${edge}`} {...floating.events(edge)} />)}
        </section>
      ) : null}

      <button
        aria-label={open ? '关闭论文助手；可拖动宠物' : '打开论文助手；可拖动宠物'}
        className={`paper-pet-launcher paper-cat-launcher ${open ? 'paper-pet-launcher-open' : ''} ${floating.petCarried ? 'paper-pet-dragging' : ''}`}
        onClick={handlePetClick}
        {...petEvents}
        onPointerUp={(event) => { const wasDragging = floating.dragging; petEvents.onPointerUp(event); if (wasDragging) showPetReaction('landing'); }}
        onPointerCancel={(event) => { petEvents.onPointerCancel(event); setPetReaction('idle'); }}
        style={floating.layout ? { left: floating.layout.pet.x, top: floating.layout.pet.y, right: 'auto', bottom: 'auto' } : undefined}
        title={isLoading ? '正在思考 · 单击查看，按住拖动' : '单击打招呼并打开对话，按住拖动'}
        type="button"
      >
        <PetSprite action={petMotion} replay={reactionId} paused={!motionEnabled} onComplete={finishPetReaction} />
      </button>
    </>
  );
}

function AssistantMark({ compact = false }: { compact?: boolean }) {
  return (
    <span aria-hidden="true" className={`assistant-mark ${compact ? 'assistant-mark-compact' : ''}`}>
      <Image alt="" draggable={false} height={96} priority={!compact} src="/assistant-cat-v2.png" width={96} />
    </span>
  );
}

function ThinkingDots() {
  return <span aria-label="正在思考" className="thinking-dots"><i /><i /><i /></span>;
}

function MessageContent({ content, sources, onSource }: { content: string; sources?: EvidenceSource[]; onSource: (source: EvidenceSource) => void }) {
  const parts = content.split(/(\[E\d+\])/g);
  return parts.map((part, index) => {
    const source = sources?.find((item) => `[${item.id}]` === part);
    if (source) return <button className="paper-page-citation" key={`${part}-${index}`} onClick={() => onSource(source)} title={source.title} type="button">[{source.referenceNumber ? `参考 ${source.referenceNumber} · ` : ''}{source.url ? source.locator ?? '外部来源' : `P${source.pageNumber}`}]</button>;
    return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>;
  });
}
