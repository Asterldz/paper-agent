import { wikiProposalSchema, type WikiContent, type WikiDraft, type WikiPage, type WikiProposal, type WikiState } from '@/types/wiki';
import type { EvidenceSource } from '@/types/agentRuntime';

export const EMPTY_WIKI: WikiState = { version: 1, pages: [], drafts: [] };
export const WIKI_LIMITS = { pages: 100, pendingDrafts: 30, history: 10 } as const;
const titleKey = (title: string) => title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function createWikiDraft(state: WikiState, input: WikiProposal, evidence: EvidenceSource[], id: string, now: number): WikiDraft {
  const value = wikiProposalSchema.parse(input);
  const page = value.pageId ? state.pages.find((page) => page.id === value.pageId) : state.pages.find((page) => titleKey(page.title) === titleKey(value.title));
  if (value.pageId && !page) throw new Error('要更新的知识页不存在，请重新检索知识库。');
  if (page && value.baseRevision !== page.revision) throw new Error('更新必须提交刚读取的基础版本 baseRevision；页面可能已变化，请重新读取。');
  if (!page && value.baseRevision && value.baseRevision !== 0) throw new Error('新页面的基础版本必须为 0。');
  if (value.relatedPageIds.some((id) => !state.pages.some((page) => page.id === id))) throw new Error('关联的知识页不存在。');
  const ids = new Set(value.claims.flatMap((claim) => claim.sourceIds));
  if (ids.size > 8) throw new Error('每个知识页最多引用 8 个原文片段，请拆分为关联页面。');
  const sources = Array.from(ids).map((id) => {
    const source = evidence.find((source) => source.id === id);
    if (!source || !source.text.trim()) throw new Error(`来源 ${id} 未在本次任务中读取，不能写入知识库。`);
    return { ...source };
  });
  if (state.drafts.filter((item) => item.status === 'pending').length >= WIKI_LIMITS.pendingDrafts) throw new Error('已有 30 份待审核草稿，请先处理后再整理。');
  const content: WikiContent = { title: value.title, kind: value.kind, claims: value.claims.map((claim) => ({ ...claim, sourceIds: [...new Set(claim.sourceIds)] })), sources,
    relatedPageIds: [...new Set(value.relatedPageIds)].filter((id) => id !== page?.id) };
  if (state.drafts.some((item) => item.status === 'pending' && item.pageId === (page?.id ?? `wiki-${id}`) && JSON.stringify(item.claims) === JSON.stringify(content.claims))) throw new Error('相同内容已有待审核草稿。');
  return { ...content, id, pageId: page?.id ?? `wiki-${id}`, baseRevision: page?.revision ?? 0, createdAt: now, reason: value.reason, status: 'pending' };
}

export function addWikiDraft(state: WikiState, draft: WikiDraft): WikiState {
  return { ...state, drafts: [draft, ...state.drafts.filter((item) => item.status === 'pending'), ...state.drafts.filter((item) => item.status !== 'pending').slice(0, 29)] };
}

function contentOf(value: WikiContent): WikiContent {
  return { title: value.title, kind: value.kind, claims: value.claims, sources: value.sources, relatedPageIds: value.relatedPageIds };
}

export function approveWikiDraft(state: WikiState, id: string, now: number): WikiState {
  const draft = state.drafts.find((item) => item.id === id && item.status === 'pending');
  if (!draft) throw new Error('草稿已处理或不存在，请刷新后重试。');
  const page = state.pages.find((item) => item.id === draft.pageId);
  if ((page?.revision ?? 0) !== draft.baseRevision) throw new Error('知识页已更新，这份草稿已过期。请基于最新页面重新整理。');
  if (state.pages.some((item) => item.id !== draft.pageId && titleKey(item.title) === titleKey(draft.title))) throw new Error('同名知识页已存在，请更新已有页面。');
  if (!page && state.pages.length >= WIKI_LIMITS.pages) throw new Error('已达到 100 个知识页上限。');
  const revision = { ...contentOf(draft), revision: (page?.revision ?? 0) + 1, reason: draft.reason, createdAt: now };
  const next: WikiPage = { ...revision, id: draft.pageId, history: page ? [...page.history, { ...contentOf(page), revision: page.revision, reason: page.reason, createdAt: page.createdAt }].slice(-WIKI_LIMITS.history) : [] };
  return { ...state, pages: [next, ...state.pages.filter((item) => item.id !== next.id)], drafts: state.drafts.map((item) => item.id === id ? { ...item, status: 'applied' } : item) };
}

export function rollbackWikiPage(state: WikiState, id: string, expectedRevision: number, targetRevision: number, now: number): WikiState {
  const page = state.pages.find((item) => item.id === id);
  if (!page || page.revision !== expectedRevision) throw new Error('知识页版本已变化，请刷新后重试。');
  const previous = page.history.find((item) => item.revision === targetRevision);
  if (!previous) throw new Error('该历史版本已不在保留范围。');
  const next = { ...page, ...contentOf(previous), revision: page.revision + 1, createdAt: now, reason: `恢复自 v${targetRevision}`,
    history: [...page.history, { ...contentOf(page), revision: page.revision, reason: page.reason, createdAt: page.createdAt }].slice(-WIKI_LIMITS.history) };
  return { ...state, pages: state.pages.map((item) => item.id === id ? next : item) };
}

export function searchWikiPages(pages: WikiPage[], query: string): WikiPage[] {
  const runs = query.toLowerCase().match(/[a-z][a-z0-9-]+|[\u3400-\u9fff]{2,}/g) ?? [];
  const terms = [...new Set(runs.flatMap((run) => /[\u3400-\u9fff]/.test(run) ? [run, ...Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))] : [run]))];
  if (!terms.length) return pages.slice(0, 8);
  return pages.map((page) => {
    const title = page.title.toLowerCase();
    const body = page.claims.map((claim) => claim.text).join(' ').toLowerCase();
    return { page, score: terms.reduce((sum, term) => sum + (title.includes(term) ? 4 : 0) + (body.includes(term) ? 1 : 0), 0) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((item) => item.page);
}

export function wikiHealth(pages: WikiPage[], localDocumentIds: Set<string>) {
  return pages.flatMap((page) => {
    const issues: string[] = [];
    if (page.sources.some((source) => !source.url && !localDocumentIds.has(source.documentId))) issues.push('部分原文已不在本地文献库，引用前需重新导入核对');
    if (page.relatedPageIds.some((id) => !pages.some((item) => item.id === id))) issues.push('存在无法打开的关联知识页');
    if (page.claims.some((claim) => claim.type === 'conflict')) issues.push('包含待核实的来源分歧');
    if (page.sources.some((source) => source.sourceKind === 'abstract')) issues.push('部分内容仅依据摘要');
    return issues.map((message) => ({ pageId: page.id, title: page.title, message }));
  });
}

export function exportWikiMarkdown(pages: WikiPage[]): string {
  const escape = (text: string) => text.replace(/[\\`*_[\]<>#]/g, '\\$&');
  return ['# 我的文献知识库', '知识页是整理结果；请通过来源核对事实。', ...pages.map((page) => `- [${escape(page.title)}](#${page.id})`),
    ...pages.map((page) => `\n<a id="${page.id}"></a>\n## ${escape(page.title)}\n\n版本 ${page.revision} · ${new Date(page.createdAt).toISOString()}\n\n` + page.claims.map((claim) =>
      `- **${claim.type === 'source' ? '文献整理' : claim.type === 'inference' ? 'AI 推断' : '来源分歧'}**：${escape(claim.text)}（${claim.sourceIds.join('、')}）`).join('\n') + '\n\n### 来源\n\n' +
      page.sources.map((source) => `- ${source.id}：${escape(source.title)} · ${escape(source.locator ?? `PDF 第 ${source.pageNumber} 页`)}${source.url ? ` · ${source.url}` : ''}\n  > ${escape(source.text).replace(/\n/g, '\n  > ')}`).join('\n\n') +
      '\n\n关联：' + page.relatedPageIds.map((id) => `[${escape(pages.find((item) => item.id === id)?.title ?? id)}](#${id})`).join('、'))].join('\n');
}
