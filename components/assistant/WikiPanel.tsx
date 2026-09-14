'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptWikiDraft, loadWiki, rejectWikiDraft, restoreWikiPage, WIKI_CHANGED } from '@/services/storage/wikiLibrary';
import { listLibraryDocuments } from '@/services/storage/documentLibrary';
import { EMPTY_WIKI, exportWikiMarkdown, searchWikiPages, wikiHealth } from '@/services/agent/wikiKnowledge';
import type { WikiContent, WikiState } from '@/types/wiki';
import type { LibraryDocument } from '@/types/library';
import type { EvidenceSource } from '@/types/agentRuntime';

const names = { paper: '论文笔记', concept: '概念解释', comparison: '多篇论文对比' };

export function WikiPanel({ onClose, onAsk, onSource, busy, currentReady }: {
  onClose: () => void; onAsk: (question: string) => void; onSource: (source: EvidenceSource) => void; busy: boolean; currentReady: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lifecycle = useRef({ generation: 0, active: true });
  const [state, setState] = useState<WikiState>(EMPTY_WIKI);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    const status = lifecycle.current;
    const request = ++status.generation;
    try {
      const [wiki, library] = await Promise.all([loadWiki(), listLibraryDocuments()]);
      if (!status.active || request !== status.generation) return;
      setState(wiki); setDocuments(library); setError(''); setLoading(false);
    } catch (error) { if (status.active && request === status.generation) { setError(error instanceof Error ? error.message : '知识库读取失败。'); setLoading(false); } }
  }, []);
  useEffect(() => {
    dialog.current?.showModal();
    const status = lifecycle.current;
    status.active = true;
    queueMicrotask(() => { if (status.active) void refresh(); });
    const sync = () => { void refresh(); };
    window.addEventListener(WIKI_CHANGED, sync); window.addEventListener('focus', sync);
    return () => { status.active = false; status.generation++; window.removeEventListener(WIKI_CHANGED, sync); window.removeEventListener('focus', sync); };
  }, [refresh]);
  const drafts = state.drafts.filter((item) => item.status === 'pending');
  const currentKey = selected || (drafts[0] ? `draft:${drafts[0].id}` : state.pages[0] ? `page:${state.pages[0].id}` : '');
  const draft = drafts.find((item) => `draft:${item.id}` === currentKey);
  const page = state.pages.find((item) => `page:${item.id}` === currentKey);
  const old = draft ? state.pages.find((item) => item.id === draft.pageId) : undefined;
  const content = draft ?? page;
  const stale = !!draft && (old?.revision ?? 0) !== draft.baseRevision;
  const found = query.trim() ? searchWikiPages(state.pages, query) : state.pages;
  const health = wikiHealth(state.pages, new Set(documents.map((item) => item.id)));
  const mutate = async (action: () => Promise<WikiState>, message: string) => {
    if (saving) return;
    setSaving(true); setError('');
    try { await action(); await refresh(); setNotice(message); setSelected(''); }
    catch (error) { setError(error instanceof Error ? error.message : '操作未完成，请重试。'); }
    finally { setSaving(false); }
  };
  const compile = (pageId?: string) => {
    const docs = documents.filter((item) => selectedDocuments.includes(item.id));
    const question = `请将${docs.length ? '以下已导入论文' : '当前论文'}整理到知识库，${pageId ? `更新知识页 ${pageId}` : topic.trim() ? `主题为「${topic.trim()}」` : '生成论文知识页，并按需关联已有概念页'}。${docs.length ? JSON.stringify(docs.map(({ id, title }) => ({ documentId: id, title }))) : ''}\n先 search_wiki 查找已有页面，再读取各篇论文的相关原文；已有页面先 read_wiki_page，保留仍有效的旧内容并整合新来源。区分研究条件、文献结论、AI 推断与来源分歧。最后必须调用 propose_wiki_update 保存完整页面草稿，等待我审核。每页尽量 4～6 条简明内容；不要仅在聊天里给整理结果。`;
    onClose(); onAsk(question);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportWikiMarkdown(state.pages)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '我的文献知识库.md'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canCompile = (currentReady || selectedDocuments.length > 0) && !busy && !saving && !loading;
  return <dialog ref={dialog} aria-labelledby="wiki-title" className="wiki-dialog" onCancel={onClose} onClose={onClose}>
    <header className="wiki-header"><div><h2 id="wiki-title">我的阅读笔记</h2><p>把论文整理成有出处的笔记，方便以后查找和提问。保存在当前设备的应用或浏览器中。</p></div><div className="flex items-center gap-2"><button className="toolbar-button" disabled={!state.pages.length || loading} onClick={download} type="button">导出笔记（Markdown）</button><button className="icon-button" aria-label="关闭知识库" onClick={onClose} type="button">×</button></div></header>
    <details className="wiki-new-note"><summary>＋ 整理新论文<span>生成有出处的阅读笔记</span></summary>
    <div className="wiki-compose">
      <label>你想整理什么？（可不填）<input className="settings-input" maxLength={120} placeholder="例如：这篇论文用了什么方法？与其他方法有什么不同？" value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2"><button className="toolbar-button toolbar-button-primary" disabled={!canCompile} onClick={() => compile()} type="button">{busy ? '助手正在处理…' : selectedDocuments.length ? `为所选 ${selectedDocuments.length} 篇生成草稿` : '为当前论文生成草稿'}</button><span>{!currentReady && !selectedDocuments.length ? '请先打开论文，或在下方选择已读文献。' : '将在助手中处理。生成后回到这里确认，不会自动修改已保存笔记。'}</span></div>
      <details><summary>选择多篇文献（最多 3 篇；不选则整理当前论文）</summary><div className="wiki-document-list">{documents.filter((item) => item.indexedAt).map((item) => <label key={item.id}><input type="checkbox" checked={selectedDocuments.includes(item.id)} disabled={!selectedDocuments.includes(item.id) && selectedDocuments.length >= 3} onChange={(event) => setSelectedDocuments((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />{item.title}</label>)}{!documents.some((item) => item.indexedAt) ? <p>先在文献库导入论文并完成文字索引。</p> : null}</div></details>
    </div></details>
    {error ? <p className="wiki-notice text-red-700" role="alert">{error}</p> : null}
    {notice ? <p className="wiki-notice" role="status">{notice}</p> : null}
    <div className="wiki-body">
      <nav aria-label="知识页目录" className="wiki-nav"><input aria-label="搜索知识页" className="settings-input mb-3" placeholder="搜索概念或论文…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <h3>等你确认 · {drafts.length}</h3>{!drafts.length ? <p className="wiki-nav-hint">没有待确认的草稿</p> : null}{drafts.map((item) => <button aria-current={draft?.id === item.id ? 'page' : undefined} key={item.id} onClick={() => setSelected(`draft:${item.id}`)} type="button">{item.title}<small>{item.baseRevision ? '已有笔记的更新草稿' : '新笔记草稿'} · 尚未生效</small></button>)}
        <h3 className="mt-4">已保存笔记 · {state.pages.length}</h3>{found.map((item) => <button aria-current={page?.id === item.id ? 'page' : undefined} key={item.id} onClick={() => setSelected(`page:${item.id}`)} type="button">{item.title}<small>{names[item.kind]}</small></button>)}
        {!loading && query && !found.length ? <p>没有匹配的知识页。</p> : null}
      </nav>
      <main className="wiki-detail">{loading ? <p>正在读取知识库…</p> : content ? <>
        <h3>{content.title}</h3><p className="wiki-meta">{names[content.kind]} · {draft ? '草稿：确认前不会被助手用于其他问答' : `已保存 · 更新于 ${new Date(page!.createdAt).toLocaleDateString()}`}</p>
        {draft ? <><p className="wiki-review-note">{draft.reason}。{old ? '采用会用下方草稿替换当前页面，旧版本可恢复。' : '请核对结论与来源是否一致，来源编号有效不代表结论必然正确。'}</p>{stale ? <p className="text-red-700">这份草稿的基础版本已过期，请重新整理。</p> : null}{old ? <details className="mb-4"><summary>对照当前版本 v{old.revision}</summary><WikiContentView content={old} onSource={onSource} /></details> : null}</> : null}
        <WikiContentView content={content} onSource={onSource} />
        {draft ? <div className="my-4 flex flex-wrap gap-3"><button className="toolbar-button toolbar-button-primary" disabled={saving || stale} onClick={() => void mutate(() => acceptWikiDraft(draft.id), '笔记已保存，助手现在可以在问答中检索。')} type="button">{saving ? '正在保存…' : old ? '确认，更新笔记' : '确认，保存笔记'}</button><button className="toolbar-button" disabled={saving} onClick={() => void mutate(() => rejectWikiDraft(draft.id), '已放弃这份草稿，已保存笔记未改变。')} type="button">放弃这份草稿</button></div> : null}
        {content.relatedPageIds.length ? <div className="my-4"><h4>关联知识页</h4>{content.relatedPageIds.map((id) => <button className="wiki-link" key={id} onClick={() => setSelected(`page:${id}`)} type="button">{state.pages.find((item) => item.id === id)?.title ?? '关联页不存在'}</button>)}</div> : null}
        {page ? <><div className="my-4 flex flex-wrap gap-2"><button className="toolbar-button" disabled={!canCompile} onClick={() => compile(page.id)} type="button">结合所选 / 当前论文更新此页</button><button className="toolbar-button" disabled={busy} onClick={() => { onClose(); onAsk(`请读取知识页 ${page.id}（${page.title}），重新核对来源后解释核心内容，明确区分原文依据、推断和分歧。`); }} type="button">让助手解释</button></div>
          {state.pages.some((item) => item.relatedPageIds.includes(page.id)) ? <div><h4>链接到此页</h4>{state.pages.filter((item) => item.relatedPageIds.includes(page.id)).map((item) => <button className="wiki-link" key={item.id} onClick={() => setSelected(`page:${item.id}`)} type="button">{item.title}</button>)}</div> : null}
          <details className="my-4"><summary>版本记录（最多保留 10 个历史版本）</summary>{[...page.history].reverse().map((version) => <details className="my-3" key={version.revision}><summary>v{version.revision} · {version.reason}</summary><WikiContentView content={version} onSource={onSource} /><button className="toolbar-button mt-2" disabled={saving} onClick={() => void mutate(() => restoreWikiPage(page.id, page.revision, version.revision), '已恢复为所选内容，并生成新版本。')} type="button">恢复此版本</button></details>)}{!page.history.length ? <p>尚无历史版本。</p> : null}</details></> : null}
      </> : <div className="wiki-empty"><span className="wiki-empty-label">阅读，从这里留下线索</span><h3>把读过的论文<br />变成自己的知识</h3><p>展开上方「整理新论文」，选择一篇论文或一个主题。助手会整理要点和出处，确认后保存在这里。</p><ol className="wiki-empty-steps"><li>选择论文或主题</li><li>核对草稿与原文</li><li>保存，随时回顾和提问</li></ol></div>}
        {health.length ? <details className="mt-6"><summary>需留意的记录 · {health.length}</summary>{health.map((item, index) => <p className="mt-2" key={`${item.pageId}-${index}`}><button className="wiki-link" onClick={() => setSelected(`page:${item.pageId}`)} type="button">{item.title}</button>：{item.message}</p>)}</details> : null}
      </main>
    </div>
  </dialog>;
}

function WikiContentView({ content, onSource }: { content: WikiContent; onSource: (source: EvidenceSource) => void }) {
  const groups = [
    { type: 'source', title: '论文说了什么', help: '从文献中整理的要点，请结合原文判断是否准确。' },
    { type: 'inference', title: '可以怎样理解', help: '助手的解释或推断，不等同于论文的结论。' },
    { type: 'disagreement', title: '哪些地方还需辨别', help: '不同来源可能存在分歧，也可能只是研究条件不同。' },
  ];
  return <div className="wiki-content">{groups.map((group) => {
    const claims = content.claims.filter((claim) => group.type === 'disagreement' ? claim.type !== 'source' && claim.type !== 'inference' : claim.type === group.type);
    if (!claims.length) return null;
    return <section className="wiki-reading-section" key={group.type}><h4>{group.title}</h4><p className="wiki-section-help">{group.help}</p><ol>{claims.map((claim, index) => <li key={index}><p>{claim.text}</p><div>{claim.sourceIds.map((id) => {
    const source = content.sources.find((source) => source.id === id);
    return source ? <button className="wiki-link" key={id} title={source.title} onClick={() => onSource(source)} type="button">查看出处：{source.title} · {source.sourceKind === 'abstract' ? '仅摘要' : source.locator ?? `第 ${source.pageNumber} 页`}</button> : <span key={id}>原文出处缺失</span>;
  })}</div></li>)}</ol></section>;
  })}<details><summary>展开原文摘录（{content.sources.length} 条）</summary>{content.sources.map((source) => <div className="wiki-source" key={source.id}><button className="wiki-link" onClick={() => onSource(source)} type="button">{source.title} · {source.locator ?? `PDF 第 ${source.pageNumber} 页`}</button><blockquote>{source.text}</blockquote></div>)}</details></div>;
}
