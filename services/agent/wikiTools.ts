import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { wikiProposalSchema } from '@/types/wiki';
import type { EvidenceSource } from '@/types/agentRuntime';
import type { LiteratureEnvironment } from './literatureTools';
import type { DocumentPageText } from '@/types/pdf';

export function createWikiTools(env: LiteratureEnvironment, sources: EvidenceSource[],
  load: (id: string) => Promise<{ title: string; pages: DocumentPageText[] }>,
  add: (documentId: string, title: string, pageNumber: number, text: string, referenceNumber?: number, external?: Pick<EvidenceSource, 'url' | 'sourceKind' | 'locator'>) => EvidenceSource | null) {
  if (!env.wiki) return [];
  const check = () => env.signal.throwIfAborted();
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  return [
    tool(async ({ query }) => {
      check();
      const pages = await env.wiki!.search(query);
      check();
      return JSON.stringify({ status: pages.length ? 'ok' : 'unavailable', pages: pages.map((page) => ({ id: page.id, title: page.title, kind: page.kind, revision: page.revision,
        excerpt: page.claims.map((claim) => claim.text).join(' ').slice(0, 500), relatedPageIds: page.relatedPageIds })),
        note: '这是人工采用过的知识整理，不是原论文。使用 read_wiki_page 读取并重新核对原文来源；不得直接把摘要内容当证据。' });
    }, { name: 'search_wiki', description: '检索已采用的跨论文知识页，寻找概念、单篇总结和专题比较。草稿不参与检索。适合先找已有研究积累或更新目标；中文或英文关键词均可。', schema: z.object({ query: z.string().trim().min(1).max(300) }).strict() }),
    tool(async ({ pageId }) => {
      check();
      const page = await env.wiki!.read(pageId);
      check();
      if (!page) return JSON.stringify({ status: 'unavailable', note: '知识页不存在或尚未采用。' });
      const verified = new Map<string, EvidenceSource>();
      const warnings: string[] = [];
      const externalReads = new Map<string, Awaited<ReturnType<NonNullable<LiteratureEnvironment['external']>['read']>>>();
      for (const snapshot of page.sources.slice(0, 8)) {
        check();
        try {
          let text: string | undefined;
          if (snapshot.url) {
            if (!env.external || !snapshot.documentId.startsWith('external:')) throw new Error('外部来源暂不可核对');
            const id = snapshot.documentId.slice('external:'.length);
            let read = externalReads.get(id);
            if (!read) { read = await env.external.read(id, env.signal); externalReads.set(id, read); }
            if ((snapshot.sourceKind ?? 'full-text') !== read.kind) throw new Error('来源访问范围已改变');
            text = read.pages.find((item) => item.pageNumber === snapshot.pageNumber)?.text;
          } else text = (await load(snapshot.documentId)).pages.find((item) => item.pageNumber === snapshot.pageNumber)?.text;
          check();
          if (!text || !normalize(text).includes(normalize(snapshot.text))) throw new Error('原文片段缺失或发生变化');
          const evidence = add(snapshot.documentId, snapshot.title, snapshot.pageNumber, snapshot.text, undefined,
            snapshot.url ? { url: snapshot.url, sourceKind: snapshot.sourceKind, locator: snapshot.locator } : undefined);
          if (evidence) verified.set(snapshot.id, evidence);
        } catch (error) { check(); warnings.push(`${snapshot.id}：${error instanceof Error ? error.message.slice(0, 100) : '原文未核对'}`); }
      }
      if (page.sources.length > 8) warnings.push('本轮最多核对 8 个来源，其余请直接检索原论文。');
      return JSON.stringify({ status: 'ok', pageId: page.id, title: page.title, revision: page.revision, relatedPageIds: page.relatedPageIds,
        claims: page.claims.map((claim) => ({ text: claim.text, type: claim.type, verifiedSourceIds: claim.sourceIds.flatMap((id) => verified.has(id) ? [verified.get(id)!.id] : []),
          allSourcesVerified: claim.sourceIds.every((id) => verified.has(id)) })), evidence: [...verified.values()], warnings,
        note: '知识页是二次整理。核对仅确认原文片段仍存在，不证明结论被原文支持；推断与分歧保持标签。只有 evidence 中的新 E 编号可引用，未核对内容只能作为待验证笔记。' });
    }, { name: 'read_wiki_page', description: '读取已采用知识页，重新检查最多 8 个原文片段后生成本轮引用。缺失、变化或只能取得摘要的来源会明确标记，不把旧知识笔记冒充新原文。', schema: z.object({ pageId: z.string().trim().min(1).max(100) }).strict() }),
    tool(async (input) => {
      check();
      const draft = await env.wiki!.propose(input, sources, env.signal);
      check();
      return JSON.stringify({ status: 'pending-review', draftId: draft.id, pageId: draft.pageId, title: draft.title, baseRevision: draft.baseRevision,
        note: '草稿已保存。告诉用户到知识库的待审核区查看和采用。尚未更新正式知识页，也不会用于其他问答；不要声称已自动审核通过。' });
    }, { name: 'propose_wiki_update', description: '把本轮已读取证据整理为知识页草稿，不直接生效。先 search_wiki 检查重复；更新时先 read_wiki_page，提交其 pageId 和 baseRevision=revision，保留已有有效结论/分歧。提交完整替换内容。每页尽量 4～6 条，每条绑定本轮实际 E 来源（共最多 8 个），区分文献整理、推断、分歧。用户可审核、拒绝或回滚。', schema: wikiProposalSchema }),
  ];
}
