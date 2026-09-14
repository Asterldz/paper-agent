import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { preparePaperAgent } from './paperRetrieval';
import { parseReferenceEntries, resolveReferences } from './referencePapers';
import type { LibraryDocument } from '@/types/library';
import type { DocumentPageText, TextSelection } from '@/types/pdf';
import type { EvidenceSource } from '@/types/agentRuntime';
import type { ExternalPaper, ExternalPaperPort, ExternalPaperRead } from '@/types/externalPaper';
import type { WikiPort } from '@/types/wiki';
import { createWikiTools } from './wikiTools';

export interface LiteratureEnvironment {
  documentId: string;
  title: string;
  pages: DocumentPageText[];
  selection: TextSelection | null;
  listDocuments: () => Promise<LibraryDocument[]>;
  loadPages: (id: string) => Promise<DocumentPageText[]>;
  lookupTerms: (text: string) => Array<{ term: string; translation: string; explanation: string }>;
  signal: AbortSignal;
  external?: ExternalPaperPort;
  wiki?: WikiPort;
}

export function createLiteratureTools(env: LiteratureEnvironment) {
  const sources: EvidenceSource[] = [];
  const documents = new Map<string, { title: string; pages: DocumentPageText[] }>();
  documents.set(env.documentId, { title: env.title, pages: env.pages });
  let library: LibraryDocument[] | undefined;
  const getLibrary = async () => library ??= await env.listDocuments();
  const check = () => env.signal.throwIfAborted();
  const add = (documentId: string, title: string, pageNumber: number, text: string, referenceNumber?: number, external?: Pick<EvidenceSource, 'url' | 'sourceKind' | 'locator'>) => {
    const content = text.trim().slice(0, 2400);
    const existing = sources.find((item) => item.documentId === documentId && item.pageNumber === pageNumber && item.text === content && item.referenceNumber === referenceNumber);
    if (existing) return existing;
    if (!content || sources.length >= 24) return null;
    const source: EvidenceSource = { id: `E${sources.length + 1}`, documentId, title, pageNumber, text: content, ...(referenceNumber ? { referenceNumber } : {}), ...external };
    sources.push(source);
    return source;
  };
  const load = async (id: string) => {
    check();
    const cached = documents.get(id);
    if (cached) return cached;
    const entry = (await getLibrary()).find((item) => item.id === id);
    if (!entry) throw new Error('该文献不在已授权的本地文献库中。');
    const pages = await env.loadPages(id);
    check();
    const result = { title: entry.title || entry.name, pages };
    documents.set(id, result);
    return result;
  };
  const search = async (documentId: string, query: string, referenceNumber?: number) => {
    const doc = await load(documentId);
    const found = preparePaperAgent(doc.pages, query, null).evidence.slice(0, 5);
    return { status: found.length ? 'ok' : 'unavailable', evidence: found.map((item) => add(documentId, doc.title, item.pageNumber, item.text, referenceNumber)).filter(Boolean),
      note: '这是实际读取的片段，不代表已逐页阅读整篇论文。' };
  };
  if (env.selection?.selectedText.trim()) add(env.documentId, env.title, env.selection.pageNumber, env.selection.selectedText);

  const externalEvidence = (read: ExternalPaperRead, query: string, number?: number) => {
    check();
    const found = preparePaperAgent(read.pages, query, null).evidence.slice(0, 5);
    return { status: found.length ? 'ok' : 'unavailable', access: read.kind, paper: { id: read.paper.id, title: read.paper.title, url: read.paper.url }, note: read.note,
      evidence: found.map((item) => add(`external:${read.paper.id}`, read.paper.title, item.pageNumber, item.text, number, {
        url: read.paper.url, sourceKind: read.kind === 'abstract' ? 'abstract' : 'full-text',
        locator: read.kind === 'abstract' ? '摘要' : read.pageKind === 'pdf' ? `PDF 第 ${item.pageNumber} 页` : `在线全文第 ${item.pageNumber} 段`,
      })).filter(Boolean) };
  };
  const referenceFromExternal = async (ref: { raw: string; doi?: string; title?: string; year?: number; number: number }, query: string) => {
    if (!env.external) return { status: 'unavailable', bibliography: ref.raw, note: '本地没有匹配全文，且当前未启用外部文献工具。' };
    const result = await env.external.search(ref.doi ?? ref.title ?? ref.raw.slice(0, 350), env.signal);
    check();
    const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const matches = (paper: ExternalPaper) => ref.doi ? paper.doi?.toLowerCase() === ref.doi.toLowerCase()
      : !!ref.title && normalized(ref.title).length >= 20 && normalized(paper.title) === normalized(ref.title) && (!ref.year || paper.year === ref.year);
    const candidates = result.papers.filter(matches);
    if (candidates.length !== 1) return { status: 'unavailable', bibliography: ref.raw, candidates: result.papers.map(({ id, title, doi, year, url }) => ({ id, title, doi, year, url })),
      warnings: result.warnings, note: '外部候选未能唯一核对 DOI 或题名/年份。候选不是已确认的参考原文，请明确说明匹配缺口。' };
    const read = await env.external.read(candidates[0].id, env.signal);
    if (!matches(read.paper)) return { status: 'unavailable', note: '读取结果与参考题录身份不符，已拒绝作为参考证据。' };
    return externalEvidence(read, query, ref.number);
  };

  const searchDocument = tool(async ({ query, documentId }) => {
    check();
    return JSON.stringify(await search(documentId || env.documentId, query));
  }, { name: 'search_document', description: '检索当前论文或已导入文献。可改写查询继续查找；query 使用论文英文关键词或“总结整篇”。documentId 为空表示当前论文。',
    schema: z.object({ query: z.string().trim().min(1).max(400), documentId: z.string().max(500).optional() }).strict() });

  const readPage = tool(async ({ page, offset, documentId }) => {
    check();
    const id = documentId || env.documentId;
    const doc = await load(id);
    const source = doc.pages.find((item) => item.pageNumber === page);
    if (!source) return JSON.stringify({ status: 'unavailable', note: '页码不存在。' });
    const start = offset ?? 0;
    return JSON.stringify({ status: 'ok', evidence: add(id, doc.title, page, source.text.slice(start, start + 2400)), nextOffset: start + 2400 < source.text.length ? start + 2400 : null });
  }, { name: 'read_page', description: '读取指定文献 PDF 页序号的原文片段。可读取相邻页补齐上下文；较长页面通过 nextOffset 继续。',
    schema: z.object({ page: z.number().int().min(1).max(100000), offset: z.number().int().min(0).max(100000).optional(), documentId: z.string().max(500).optional() }).strict() });

  const listReferences = tool(async ({ query, offset }) => {
    check();
    const references = resolveReferences(parseReferenceEntries(env.pages), await getLibrary(), env.documentId);
    const tokens = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = tokens.length ? references.filter((item) => tokens.some((token) => `${item.number} ${item.raw}`.toLowerCase().includes(token))) : references;
    const start = offset ?? 0;
    return JSON.stringify({ status: filtered.length ? 'ok' : 'unavailable', total: filtered.length,
      references: filtered.slice(start, start + 12).map((item) => ({ number: item.number, title: item.title, raw: item.raw.slice(0, 700), doi: item.doi,
        localMatchCandidate: item.matchedDocumentId, matchConfidence: item.matchConfidence, fullTextRead: false })),
      nextOffset: start + 12 < filtered.length ? start + 12 : null,
      note: '这里只提供题录与本地候选；只有 read_reference 返回的证据才来自核对身份后的参考论文。' });
  }, { name: 'list_references', description: '解析当前论文参考文献。按编号/英文题名关键词查找；不提供原始论文结论。',
    schema: z.object({ query: z.string().max(300).optional(), offset: z.number().int().min(0).max(300).optional() }).strict() });

  const readReference = tool(async ({ number, query }) => {
    check();
    const ref = resolveReferences(parseReferenceEntries(env.pages), await getLibrary(), env.documentId).find((item) => item.number === number);
    if (!ref) return JSON.stringify({ status: 'unavailable', note: `没有解析到参考文献 ${number}。` });
    if (!ref.matchedDocumentId) return JSON.stringify(await referenceFromExternal(ref, query));
    const doc = await load(ref.matchedDocumentId);
    const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const opening = normalize(doc.pages.slice(0, 2).map((page) => page.text).join(' '));
    const title = normalize(ref.title ?? '');
    const identityMatched = (ref.doi && opening.includes(normalize(ref.doi))) || (title.length >= 20 && opening.includes(title));
    if (!identityMatched) return JSON.stringify(await referenceFromExternal(ref, query));
    return JSON.stringify(await search(ref.matchedDocumentId, query, number));
  }, { name: 'read_reference', description: '按当前论文引用编号查证参考论文。先找本地全文，缺失或身份不符时自动检索外部开放来源；核对 DOI 或题名/年份后读取。区分全文、摘要和题录。',
    schema: z.object({ number: z.number().int().min(1).max(999), query: z.string().trim().min(1).max(400) }).strict() });

  const searchLibrary = tool(async ({ query }) => {
    check();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = (await getLibrary()).filter((item) => words.some((word) => `${item.title} ${item.name} ${item.tags.join(' ')}`.toLowerCase().includes(word)));
    return JSON.stringify({ status: results.length ? 'ok' : 'unavailable', documents: results.slice(0, 12).map((item) => ({ documentId: item.id, title: item.title, indexed: Boolean(item.indexedAt), category: item.category, tags: item.tags })),
      note: '这是本地目录，可再调用 search_document 读取。整理建议不等于文件已移动。' });
  }, { name: 'search_library', description: '检索用户已导入的本地文献目录，寻找比较对象或提出分类整理建议。只读，不移动或删除文件。',
    schema: z.object({ query: z.string().trim().min(1).max(300) }).strict() });

  const lookupTerm = tool(async ({ text }) => {
    check();
    return JSON.stringify({ terms: env.lookupTerms(text).slice(0, 6), note: '术语记忆仅供语境消歧，不是论文事实的来源。' });
  }, { name: 'lookup_terms', description: '查询已记忆的相关术语，结合上下文判断词义；不将记忆当作当前论文原文。',
    schema: z.object({ text: z.string().trim().min(1).max(600) }).strict() });

  const externalTools = env.external ? [
    tool(async ({ query }) => {
      check();
      const result = await env.external!.search(query, env.signal);
      check();
      return JSON.stringify({ status: result.papers.length ? 'ok' : 'unavailable', ...result,
        note: '检索结果仅为候选题录/摘要，尚未读取全文。使用 read_external_paper 读取目标；不要从题名推断结论。' });
    }, { name: 'search_external_papers', description: '联网检索外部文献（Crossref、Europe PMC），支持题名、英文关键词、DOI、PMCID 或 arXiv 编号/链接。返回候选及身份信息。',
      schema: z.object({ query: z.string().trim().min(1).max(400) }).strict() }),
    tool(async ({ id, query }) => {
      check();
      return JSON.stringify(externalEvidence(await env.external!.read(id, env.signal), query));
    }, { name: 'read_external_paper', description: '读取外部论文并检索原文。id 使用检索结果编号或用户给出的 DOI/PMCID/arXiv 编号。支持 Europe PMC 开放全文、arXiv PDF；其余来源可能仅有摘要/题录，不绕过付费墙。',
      schema: z.object({ id: z.string().trim().min(1).max(300), query: z.string().trim().min(1).max(400) }).strict() }),
  ] : [];
  return { tools: [searchDocument, readPage, listReferences, readReference, searchLibrary, lookupTerm, ...externalTools, ...createWikiTools(env, sources, load, add)], sources };
}
