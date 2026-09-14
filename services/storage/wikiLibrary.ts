import type { EvidenceSource } from '@/types/agentRuntime';
import type { WikiPort, WikiProposal, WikiState } from '@/types/wiki';
import { addWikiDraft, approveWikiDraft, createWikiDraft, EMPTY_WIKI, rollbackWikiPage, searchWikiPages } from '@/services/agent/wikiKnowledge';

export const WIKI_CHANGED = 'paper-agent-wiki-changed';
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前环境不支持本地知识库。')); return; }
    const request = indexedDB.open('paper-agent-wiki', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开知识库。'));
  });
}

async function transact(action?: (state: WikiState) => WikiState, signal?: AbortSignal): Promise<WikiState> {
  signal?.throwIfAborted();
  const db = await database();
  try {
    return await new Promise<WikiState>((resolve, reject) => {
      const transaction = db.transaction('state', action ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('state');
      let result: WikiState; let failure: unknown;
      const abort = () => { try { transaction.abort(); } catch { /* Already finished. */ } };
      signal?.addEventListener('abort', abort, { once: true });
      const read = store.get('wiki');
      read.onsuccess = () => {
        try {
          signal?.throwIfAborted();
          const state = read.result ?? structuredClone(EMPTY_WIKI);
          if (state.version !== 1 || !Array.isArray(state.pages) || !Array.isArray(state.drafts)) throw new Error('知识库格式无法识别，未覆盖原数据。');
          result = action ? action(state) : state;
          if (action) store.put(result, 'wiki');
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => {
        signal?.removeEventListener('abort', abort);
        if (action) window.dispatchEvent(new Event(WIKI_CHANGED));
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => { signal?.removeEventListener('abort', abort); reject(failure ?? transaction.error ?? new Error('知识库操作已取消或存储空间不足。')); };
    });
  } finally { db.close(); }
}

export const loadWiki = () => transact();
export async function proposeWiki(input: WikiProposal, sources: EvidenceSource[], signal: AbortSignal) {
  const id = crypto.randomUUID();
  const result = await transact((state) => addWikiDraft(state, createWikiDraft(state, input, sources, id, Date.now())), signal);
  return result.drafts.find((item) => item.id === id)!;
}
export const acceptWikiDraft = (id: string) => transact((state) => approveWikiDraft(state, id, Date.now()));
export const rejectWikiDraft = (id: string) => transact((state) => ({ ...state, drafts: state.drafts.map((item) => item.id === id && item.status === 'pending' ? { ...item, status: 'rejected' } : item) }));
export const restoreWikiPage = (id: string, current: number, target: number) => transact((state) => rollbackWikiPage(state, id, current, target, Date.now()));
export const wikiLibrary: WikiPort = {
  search: async (query) => searchWikiPages((await loadWiki()).pages, query),
  read: async (id) => (await loadWiki()).pages.find((item) => item.id === id),
  propose: proposeWiki,
};
