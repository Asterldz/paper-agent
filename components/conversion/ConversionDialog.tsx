'use client';

import { useState } from 'react';
import type { PdfExportFormat } from '@/services/pdf/pdfConverter';

export function ConversionDialog({ fileName, onClose, onConvert }: {
  fileName: string;
  onClose: () => void;
  onConvert: (format: PdfExportFormat, onProgress: (completed: number, total: number) => void) => Promise<void>;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; message: string }>({ status: 'idle', message: '' });

  const convert = async (format: PdfExportFormat) => {
    setState({ status: 'working', message: '正在提取 PDF 文字…' });
    try {
      await onConvert(format, (completed, total) => setState({ status: 'working', message: `正在处理第 ${completed} / ${total} 页…` }));
      setState({ status: 'done', message: '转换完成，文件已开始下载。' });
    } catch {
      setState({ status: 'error', message: '转换失败。扫描版 PDF 可能没有可提取的文字层。' });
    }
  };

  return (
    <div aria-modal="true" className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && state.status !== 'working') onClose(); }} role="dialog">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#dfe2e7] bg-white shadow-[0_24px_80px_rgba(25,29,38,0.22)]">
        <header className="flex h-14 items-center justify-between border-b border-[#e4e6ea] px-5"><div><h2 className="text-sm font-semibold">文件转换</h2><p className="mt-0.5 max-w-72 truncate text-[10px] text-[#969ca6]">{fileName}</p></div><button aria-label="关闭" className="icon-button" disabled={state.status === 'working'} onClick={onClose} type="button">×</button></header>
        <div className="p-6">
          <p className="text-xs leading-5 text-[#747b87]">在当前设备中提取论文文字，不上传 PDF。适合做笔记、全文检索或导入其他写作工具。</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="conversion-option" disabled={state.status === 'working'} onClick={() => void convert('txt')} type="button"><span className="text-lg font-semibold text-[#3157d5]">TXT</span><span>纯文本</span></button>
            <button className="conversion-option" disabled={state.status === 'working'} onClick={() => void convert('markdown')} type="button"><span className="text-lg font-semibold text-[#3157d5]">MD</span><span>Markdown</span></button>
          </div>
          {state.status !== 'idle' ? <p className={`mt-4 text-xs ${state.status === 'error' ? 'text-red-600' : state.status === 'done' ? 'text-emerald-700' : 'text-[#6f7681]'}`}>{state.message}</p> : null}
          <p className="mt-5 text-[10px] leading-4 text-[#a0a5ae]">说明：扫描图片型 PDF 需要 OCR，当前版本暂不转换图片中的文字。</p>
        </div>
      </div>
    </div>
  );
}
