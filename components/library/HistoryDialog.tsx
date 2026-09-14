'use client';

import { useMemo, useState } from 'react';
import type { LibraryDocument, PaperCategory } from '@/types/library';

const CATEGORIES: PaperCategory[] = ['人工智能', '计算机视觉', '自然语言处理', '脑科学与生物信号', '医学与生命科学', '工程与机器人', '材料与物理', '数据与统计', '社会科学', '未分类'];

export function HistoryDialog({ activeDocumentId, documents, error, isImporting, isLoading, onCategoryChange, onClose, onDelete, onImport, onOpen, onToggleFavorite }: {
  activeDocumentId: string | null;
  documents: LibraryDocument[];
  error: string | null;
  isImporting: boolean;
  isLoading: boolean;
  onCategoryChange: (id: string, category: PaperCategory) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  onOpen: (document: LibraryDocument) => void;
  onToggleFavorite: (document: LibraryDocument) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PaperCategory | '全部'>('全部');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return documents.filter((document) => (
      (category === '全部' || document.category === category)
      && (!normalized || `${document.title} ${document.name} ${document.category} ${document.tags.join(' ')}`.toLocaleLowerCase().includes(normalized))
    ));
  }, [category, documents, query]);
  const grouped = useMemo(() => {
    const result = new Map<PaperCategory, LibraryDocument[]>();
    for (const document of filtered) {
      const group = result.get(document.category) ?? [];
      group.push(document);
      result.set(document.category, group);
    }
    return Array.from(result.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN'));
  }, [filtered]);

  return (
    <div aria-modal="true" className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <div className="library-dialog w-full overflow-hidden border border-[#dfe2e7] bg-white shadow-[0_24px_80px_rgba(25,29,38,0.22)]">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[#e4e6ea] px-5 py-3">
          <div><h2 className="text-sm font-semibold">文献库</h2><p className="mt-0.5 text-[10px] text-[#969ca6]">{documents.length} 篇文献 · 自动按研究主题整理 · 文件保存在当前设备</p></div>
          <div className="flex items-center gap-2"><button className="toolbar-button toolbar-button-primary" disabled={isImporting} onClick={onImport} type="button">{isImporting ? '正在整理…' : '批量导入'}</button><button aria-label="关闭文献库" className="icon-button" onClick={onClose} type="button">×</button></div>
        </header>
        <div className="library-controls border-b border-[#eceef1] px-4 py-3">
          <input aria-label="搜索文献" className="library-search" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、文件名、分类或关键词…" value={query} />
          <div className="library-category-strip">
            <button className={category === '全部' ? 'active' : ''} onClick={() => setCategory('全部')} type="button">全部 <span>{documents.length}</span></button>
            {CATEGORIES.filter((item) => documents.some((document) => document.category === item)).map((item) => (
              <button className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)} type="button">{item} <span>{documents.filter((document) => document.category === item).length}</span></button>
            ))}
          </div>
        </div>
        <div className="max-h-[68dvh] min-h-64 overflow-auto p-4">
          {isLoading ? <p className="py-10 text-center text-xs text-[#9298a3]">正在读取本地文献库…</p> : null}
          {!isLoading && error ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">{error}</p> : null}
          {!isLoading && !documents.length ? <div className="py-14 text-center"><p className="text-sm font-medium text-[#606773]">文献库还是空的</p><p className="mt-2 text-xs text-[#9aa0aa]">可一次选择多篇 PDF，系统会自动提取文本并按主题归类</p><button className="primary-button mt-5 px-5 py-2 text-xs" onClick={onImport} type="button">导入文献</button></div> : null}
          {!isLoading && documents.length > 0 && !filtered.length ? <p className="py-12 text-center text-xs text-[#9298a3]">没有找到匹配的文献</p> : null}
          <div className="space-y-5">
            {grouped.map(([groupName, groupDocuments]) => (
              <section key={groupName}>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-[11px] font-semibold text-[#676c75]">{groupName}</h3><span className="text-[9px] text-[#a0a5ae]">{groupDocuments.length} 篇</span></div>
                <div className="space-y-2">
                  {groupDocuments.map((document) => (
                    <div className={`library-row ${document.id === activeDocumentId ? 'library-row-active' : ''}`} key={document.id}>
                      <button aria-label={document.favorite ? `取消收藏 ${document.title}` : `收藏 ${document.title}`} className={`library-favorite ${document.favorite ? 'active' : ''}`} onClick={() => onToggleFavorite(document)} title={document.favorite ? '取消收藏' : '收藏'} type="button">★</button>
                      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(document)} type="button">
                        <span className="block truncate text-xs font-medium text-[#414750]">{document.title}</span>
                        <span className="mt-1 block truncate text-[10px] text-[#9298a3]">{document.indexedAt ? `已建立全文索引 · ${document.totalPages || '—'} 页` : '等待建立全文索引'} · 读到第 {document.currentPage} 页 · {formatDate(document.lastReadAt)}</span>
                        {document.tags.length ? <span className="mt-1.5 flex flex-wrap gap-1">{document.tags.slice(0, 4).map((tag) => <span className="library-tag" key={tag}>{tag}</span>)}</span> : null}
                      </button>
                      <select aria-label={`修改 ${document.title} 的分类`} className="library-category-select" onChange={(event) => onCategoryChange(document.id, event.target.value as PaperCategory)} value={document.category}>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                      <button aria-label={`删除 ${document.title}`} className="icon-button shrink-0 text-[#a0a6b0] hover:text-red-600" onClick={() => onDelete(document.id)} title="从本地文献库删除" type="button">×</button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}
