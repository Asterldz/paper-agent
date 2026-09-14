'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseReferenceEntries, resolveReferences } from '@/services/agent/referencePapers';
import { loadLibraryDocumentReferences } from '@/services/storage/documentLibrary';
import type { LibraryDocument, ReferenceEntry, ResolvedReference } from '@/types/library';
import type { DocumentPageText } from '@/types/pdf';

interface ReferenceDialogProps {
  activeDocumentId: string;
  currentPages: DocumentPageText[];
  documents: LibraryDocument[];
  onClose: () => void;
  onImport: () => void;
  onNavigate: (page: number) => void;
  onOpenDocument: (document: LibraryDocument, page?: number) => void;
}

export function ReferenceDialog(props: ReferenceDialogProps) {
  const fallbackReferences = useMemo(() => parseReferenceEntries(props.currentPages), [props.currentPages]);
  const [references, setReferences] = useState<ReferenceEntry[]>(fallbackReferences);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadLibraryDocumentReferences(props.activeDocumentId)
      .then((stored) => { if (!cancelled) setReferences(stored.length ? stored : fallbackReferences); })
      .catch(() => { if (!cancelled) setReferences(fallbackReferences); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fallbackReferences, props.activeDocumentId]);

  const resolved = useMemo(
    () => resolveReferences(references, props.documents, props.activeDocumentId),
    [props.activeDocumentId, props.documents, references],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? resolved.filter((reference) => `${reference.number} ${reference.title ?? ''} ${reference.raw} ${reference.doi ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
    : resolved;
  const matchedCount = resolved.filter((reference) => reference.matchedDocumentId).length;
  const indexedCount = resolved.filter((reference) => {
    const document = props.documents.find((item) => item.id === reference.matchedDocumentId);
    return Boolean(document?.indexedAt);
  }).length;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section aria-label="当前论文参考文献" className="reference-dialog flex w-full max-w-[980px] flex-col overflow-hidden bg-white">
        <header className="flex items-start gap-4 border-b border-[#e1e3e7] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="section-kicker">REFERENCE PAPERS</p>
            <h2 className="mt-1 text-base font-semibold text-[#303238]">当前论文的参考文献</h2>
            <p className="mt-1 text-[10px] leading-4 text-[#8b9098]">自动解析题录并与设备上的文献库匹配。只有“全文可检索”的论文会进入联合问答。</p>
          </div>
          <button aria-label="关闭参考文献" className="icon-button" onClick={props.onClose} type="button">×</button>
        </header>

        <div className="reference-summary border-b border-[#e7e9ed] px-5 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[10px] text-[#70757d]">
            <span>识别 {resolved.length} 条</span><span className="text-[#c5c8ce]">/</span><span>本地匹配 {matchedCount} 篇</span><span className="text-[#c5c8ce]">/</span><span>全文可检索 {indexedCount} 篇</span>
          </div>
          <input aria-label="搜索参考文献" className="library-search max-w-[340px]" onChange={(event) => setQuery(event.target.value)} placeholder="搜索编号、标题、作者或 DOI" value={query} />
          <button className="toolbar-button toolbar-button-primary" onClick={props.onImport} type="button">导入参考论文 PDF</button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#f7f8fa] p-4">
          {loading && !resolved.length ? <div className="reference-empty">正在解析参考文献…</div> : null}
          {!loading && !resolved.length ? (
            <div className="reference-empty">
              <p className="font-semibold text-[#555a63]">没有识别到编号式参考文献</p>
              <p className="mt-1">需要 PDF 含可提取文字，并具有 References、Bibliography 或“参考文献”标题。扫描版 PDF 需先 OCR。</p>
            </div>
          ) : null}
          <div className="space-y-2">
            {filtered.map((reference) => (
              <ReferenceRow
                documents={props.documents}
                key={reference.id}
                onImport={props.onImport}
                onNavigate={(page) => { props.onNavigate(page); props.onClose(); }}
                onOpenDocument={props.onOpenDocument}
                reference={reference}
              />
            ))}
          </div>
          {!loading && resolved.length > 0 && !filtered.length ? <div className="reference-empty">没有匹配的参考文献。</div> : null}
        </div>
      </section>
    </div>
  );
}

function ReferenceRow({ documents, reference, onImport, onNavigate, onOpenDocument }: {
  documents: LibraryDocument[];
  reference: ResolvedReference;
  onImport: () => void;
  onNavigate: (page: number) => void;
  onOpenDocument: (document: LibraryDocument, page?: number) => void;
}) {
  const document = documents.find((item) => item.id === reference.matchedDocumentId);
  const searchable = Boolean(document?.indexedAt);
  return (
    <article className="reference-row">
      <button className="reference-number" onClick={() => onNavigate(reference.bibliographyPage)} title={`跳转到题录所在的第 ${reference.bibliographyPage} 页`} type="button">[{reference.number}]</button>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold leading-5 text-[#41454d]">{reference.title || reference.raw}</p>
        {reference.title ? <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[#858a93]">{reference.raw}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-[#8a9099]">
          {reference.year ? <span>{reference.year}</span> : null}
          {reference.doi ? <span className="reference-doi">DOI {reference.doi}</span> : null}
          {document ? <span className={`reference-status ${searchable ? 'reference-status-ready' : ''}`}>{searchable ? '全文可检索' : '已导入，待索引'}</span> : <span className="reference-status">本地未找到</span>}
          {document && reference.matchConfidence < 0.62 ? <span title="文件名与题录相似，但建议打开核对">可能匹配</span> : null}
        </div>
      </div>
      {document ? <button className="reference-action" onClick={() => onOpenDocument(document)} type="button">打开全文</button> : <button className="reference-action" onClick={onImport} type="button">导入 PDF</button>}
    </article>
  );
}
