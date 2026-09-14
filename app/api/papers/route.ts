import { normalizeExternalId, readExternalPaper, searchExternalPapers } from '@/services/agent/externalPaperServer';

let active = 0;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const action = params.get('action');
  const query = params.get('query')?.trim() ?? '';
  const id = normalizeExternalId(params.get('id') ?? '');
  if ((action !== 'search' && action !== 'read') || (action === 'search' && (!query || query.length > 400)) || (action === 'read' && !id)) {
    return Response.json({ error: '请提供论文题名、DOI、PMCID 或 arXiv 编号。' }, { status: 400 });
  }
  if (active >= 4) return Response.json({ error: '外部论文读取繁忙，请稍后重试。' }, { status: 429 });
  active++;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    const result = action === 'search' ? await searchExternalPapers(query, signal) : await readExternalPaper(id!, signal);
    const response = result instanceof Response ? result : Response.json(result);
    response.headers.set('Cache-Control', 'private, max-age=600');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '外部论文读取失败。' }, { status: 502 });
  } finally { active--; }
}
