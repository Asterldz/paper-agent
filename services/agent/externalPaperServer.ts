import type { ExternalPaper, ExternalPaperRead } from '@/types/externalPaper';

const PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const CROSSREF = 'https://api.crossref.org/works';
const HOSTS = new Set(['www.ebi.ac.uk', 'api.crossref.org', 'arxiv.org', 'export.arxiv.org']);
const DOI = /^10\.\d{4,9}\/[^\s<>"?#]+$/i;
const ARXIV = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;

export function normalizeExternalId(input: string): string | null {
  const value = input.trim();
  if (/^PMC\d+$/i.test(value)) return value.toUpperCase();
  const doi = value.replace(/^doi:/i, '').replace(/^https:\/\/(?:dx\.)?doi\.org\//i, '');
  if (doi.length <= 250 && DOI.test(doi)) {
    const arxiv = doi.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
    return arxiv && ARXIV.test(arxiv) ? `arxiv:${arxiv}` : `doi:${doi.toLowerCase()}`;
  }
  const arxiv = value.replace(/^arxiv:/i, '').replace(/^https:\/\/arxiv\.org\/(?:abs|pdf)\//i, '').replace(/\.pdf$/i, '');
  return ARXIV.test(arxiv) ? `arxiv:${arxiv}` : null;
}

// Only identifier-derived requests to fixed academic services are permitted.
// Every redirect is checked; no user/model URL is ever used as a fetch target.
export async function fetchAcademic(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch, maxBytes = 2_000_000): Promise<Response> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(18_000)]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !HOSTS.has(target.hostname) || target.username || target.password || target.port) throw new Error('不支持该外部来源。');
    const response = await fetcher(target.toString(), { signal: timeout, redirect: 'manual', headers: { Accept: '*/*' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('论文来源返回了无效跳转。');
      url = new URL(location, target).toString(); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`论文来源暂不可用（HTTP ${response.status}）。`); }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('外部文件超过读取大小上限。'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('论文来源没有返回内容。');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        timeout.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('外部文件超过读取大小上限。');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream' } });
  }
  throw new Error('论文来源跳转次数过多。');
}

export function plainXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => {
      const n = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (value) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[value] ?? value)
    .replace(/\s+/g, ' ').trim();
}

interface PmcRecord { id: string; source: string; title?: string; doi?: string; pmcid?: string; pubYear?: string; abstractText?: string }
async function pmcSearch(query: string, signal: AbortSignal, fetcher: typeof fetch): Promise<ExternalPaper[]> {
  const response = await fetchAcademic(`${PMC}/search?${new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: '5' })}`, signal, fetcher);
  const data = await response.json() as { resultList?: { result?: PmcRecord[] } };
  return (data.resultList?.result ?? []).flatMap((item) => {
    const id = (item.pmcid ? normalizeExternalId(item.pmcid) : null) || (item.doi ? normalizeExternalId(item.doi) : null);
    if (!id || !item.title) return [];
    return [{ id, title: plainXml(item.title), doi: item.doi, pmcid: item.pmcid, year: Number(item.pubYear) || undefined,
      abstract: item.abstractText ? plainXml(item.abstractText).slice(0, 12000) : undefined,
      url: item.pmcid ? `https://europepmc.org/articles/${item.pmcid}` : `https://doi.org/${item.doi}`, provider: 'Europe PMC' as const }];
  });
}

interface CrossrefRecord { DOI?: string; title?: string[]; abstract?: string; published?: { 'date-parts'?: number[][] } }
function crossrefPaper(item: CrossrefRecord): ExternalPaper | null {
  const id = item.DOI && normalizeExternalId(item.DOI);
  if (!id || !item.title?.[0]) return null;
  return { id, title: plainXml(item.title[0]), doi: item.DOI, year: item.published?.['date-parts']?.[0]?.[0],
    abstract: item.abstract ? plainXml(item.abstract).slice(0, 12000) : undefined,
    url: `https://doi.org/${item.DOI}`, provider: 'Crossref' };
}

async function arxivPaper(id: string, signal: AbortSignal, fetcher: typeof fetch): Promise<ExternalPaper> {
  const xml = await (await fetchAcademic(`https://export.arxiv.org/api/query?${new URLSearchParams({ id_list: id.slice(6) })}`, signal, fetcher)).text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  const title = entry?.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  const returnedId = entry?.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.replace(/^https?:\/\/arxiv.org\/abs\//, '').trim();
  if (!title || returnedId?.replace(/v\d+$/, '') !== id.slice(6).replace(/v\d+$/, '')) throw new Error('未找到对应 arXiv 论文。');
  return { id, title: plainXml(title), provider: 'arXiv', doi: `10.48550/arXiv.${id.slice(6).replace(/v\d+$/, '')}`, url: `https://arxiv.org/abs/${id.slice(6)}`,
    abstract: plainXml(entry?.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '') };
}

export async function searchExternalPapers(query: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const id = normalizeExternalId(query);
  if (id?.startsWith('arxiv:')) return { papers: [await arxivPaper(id, signal, fetcher)], warnings: [] };
  const results = await Promise.allSettled([
    pmcSearch(id?.startsWith('doi:') ? `DOI:"${id.slice(4)}"` : id?.startsWith('PMC') ? `PMCID:${id}` : query, signal, fetcher),
    (async () => {
      if (id?.startsWith('PMC')) return [];
      const url = id?.startsWith('doi:') ? `${CROSSREF}/${encodeURIComponent(id.slice(4))}` : `${CROSSREF}?${new URLSearchParams({ 'query.bibliographic': query, rows: '5' })}`;
      const data = await (await fetchAcademic(url, signal, fetcher)).json() as { message: CrossrefRecord & { items?: CrossrefRecord[] } };
      return (id ? [data.message] : data.message.items ?? []).map(crossrefPaper).filter((item): item is ExternalPaper => !!item);
    })(),
  ]);
  signal.throwIfAborted();
  const papers: ExternalPaper[] = []; const warnings: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') { warnings.push(`${index ? 'Crossref' : 'Europe PMC'} 检索未完成：${result.reason instanceof Error ? result.reason.message : '服务不可用'}`); return; }
    for (const paper of result.value) if (!papers.some((item) => item.id === paper.id || (item.doi && item.doi.toLowerCase() === paper.doi?.toLowerCase()))) papers.push(paper);
  });
  return { papers: papers.slice(0, 8), warnings };
}

export function parsePmcFullText(xml: string, paper: ExternalPaper): ExternalPaperRead {
  const pmcid = xml.match(/<article-id\b[^>]*pub-id-type=["'](?:pmcid|pmc)["'][^>]*>([\s\S]*?)<\/article-id>/i)?.[1];
  if (!pmcid || `PMC${plainXml(pmcid).replace(/^PMC/i, '')}` !== paper.pmcid) throw new Error('返回全文的论文编号不匹配。');
  const body = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!body) throw new Error('该来源没有提供可读取的正文。');
  const paragraphs = Array.from(body.matchAll(/<(?:p|title)\b[^>]*>([\s\S]*?)<\/(?:p|title)>/gi)).map((match) => plainXml(match[1])).filter(Boolean);
  const text = paragraphs.join('\n');
  if (text.length < 100) throw new Error('全文没有足够的可提取文字。');
  const pages = paragraphs.map((text, index) => ({ pageNumber: index + 1, text }));
  return { paper, kind: 'full-text', pages, pageKind: 'section', note: '已取得开放全文；定位编号为在线正文段落，并非 PDF 页码。仅检索出的片段用于回答。' };
}

export async function readExternalPaper(id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ExternalPaperRead | Response> {
  const normalized = normalizeExternalId(id);
  if (!normalized) throw new Error('无效的论文编号。');
  id = normalized;
  if (id.startsWith('arxiv:')) {
    const paper = await arxivPaper(id, signal, fetcher);
    try {
      const pdf = await fetchAcademic(`https://arxiv.org/pdf/${id.slice(6)}`, signal, fetcher, 12_000_000);
      const bytes = await pdf.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('来源没有返回 PDF。');
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ ...paper, abstract: undefined })) } });
    } catch (error) {
      signal.throwIfAborted();
      return abstractOnly(paper, `PDF 未取得：${error instanceof Error ? error.message : '来源不可用'}`);
    }
  }
  const { papers, warnings } = await searchExternalPapers(id, signal, fetcher);
  const paper = papers.find((item) => item.id === id || (id.startsWith('doi:') && item.doi?.toLowerCase() === id.slice(4)));
  if (!paper) throw new Error(warnings.length ? warnings.join('；') : '未找到对应论文，或来源未收录。');
  if (paper.pmcid) {
    try {
      const xml = await (await fetchAcademic(`${PMC}/${paper.pmcid}/fullTextXML`, signal, fetcher, 6_000_000)).text();
      return parsePmcFullText(xml, paper);
    } catch (error) {
      signal.throwIfAborted();
      return abstractOnly(paper, `开放全文未取得：${error instanceof Error ? error.message : '来源不可用'}`);
    }
  }
  return abstractOnly(paper, '当前来源未提供可自动读取的开放全文，可通过来源链接访问或手动导入 PDF。');
}

function abstractOnly(paper: ExternalPaper, note: string): ExternalPaperRead {
  return { paper, kind: paper.abstract ? 'abstract' : 'metadata', pageKind: 'section',
    pages: paper.abstract ? [{ pageNumber: 1, text: paper.abstract }] : [], note: `${note} ${paper.abstract ? '仅取得摘要，不代表已阅读正文。' : '只有题录，不含原文证据。'}` };
}
