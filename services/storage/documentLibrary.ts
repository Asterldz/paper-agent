import type { LibraryDocument } from '@/types/library';
import type { PaperCategory } from '@/types/library';
import type { ReferenceEntry } from '@/types/library';
import type { DocumentPageText } from '@/types/pdf';
import { parseReferenceEntries } from '@/services/agent/referencePapers';

const DATABASE_NAME = 'paper-agent-library';
const DATABASE_VERSION = 2;
const DOCUMENTS_STORE = 'documents';
const FILES_STORE = 'files';
const INDEXES_STORE = 'indexes';
const MAX_SAVED_DOCUMENTS = 80;

interface StoredFile {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

interface StoredDocumentIndex {
  id: string;
  pages: DocumentPageText[];
  references?: ReferenceEntry[];
  updatedAt: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('浏览器存储操作失败。'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器存储事务失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器存储事务已取消。'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('当前浏览器不支持本地文献库。');
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
    if (!database.objectStoreNames.contains(FILES_STORE)) database.createObjectStore(FILES_STORE, { keyPath: 'id' });
    if (!database.objectStoreNames.contains(INDEXES_STORE)) database.createObjectStore(INDEXES_STORE, { keyPath: 'id' });
  };
  return requestResult(request);
}

export function documentIdForFile(file: File): string {
  return `${file.lastModified}:${file.size}:${file.name}`;
}

export async function listLibraryDocuments(): Promise<LibraryDocument[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const done = transactionDone(transaction);
    const documents = await requestResult(transaction.objectStore(DOCUMENTS_STORE).getAll()) as LibraryDocument[];
    await done;
    return documents.map(normalizeLibraryDocument).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastReadAt - a.lastReadAt);
  } finally {
    database.close();
  }
}

export async function saveLibraryDocument(file: File): Promise<LibraryDocument> {
  const database = await openDatabase();
  const id = documentIdForFile(file);
  const now = Date.now();
  try {
    const readTransaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const readDone = transactionDone(readTransaction);
    const existing = await requestResult(readTransaction.objectStore(DOCUMENTS_STORE).get(id)) as LibraryDocument | undefined;
    await readDone;
    const document: LibraryDocument = {
      id,
      name: file.name,
      title: existing?.title ?? titleFromFileName(file.name),
      size: file.size,
      type: file.type || 'application/pdf',
      lastModified: file.lastModified,
      firstOpenedAt: existing?.firstOpenedAt ?? now,
      lastReadAt: now,
      currentPage: existing?.currentPage ?? 1,
      totalPages: existing?.totalPages ?? 0,
      category: existing?.category ?? '未分类',
      tags: existing?.tags ?? [],
      favorite: existing?.favorite ?? false,
      indexedAt: existing?.indexedAt,
    };
    const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE], 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).put(document);
    transaction.objectStore(FILES_STORE).put({ id, blob: file, name: file.name, type: document.type, lastModified: file.lastModified } satisfies StoredFile);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  await pruneLibrary();
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
  return (await listLibraryDocuments()).find((document) => document.id === id)!;
}

export async function loadLibraryFile(id: string): Promise<File> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(FILES_STORE, 'readonly');
    const done = transactionDone(transaction);
    const stored = await requestResult(transaction.objectStore(FILES_STORE).get(id)) as StoredFile | undefined;
    await done;
    if (!stored) throw new Error('本地文献文件已不存在。');
    return new File([stored.blob], stored.name, { type: stored.type, lastModified: stored.lastModified });
  } finally {
    database.close();
  }
}

export async function updateLibraryProgress(id: string, currentPage: number, totalPages: number): Promise<void> {
  const database = await openDatabase();
  try {
    const readTransaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const readDone = transactionDone(readTransaction);
    const document = await requestResult(readTransaction.objectStore(DOCUMENTS_STORE).get(id)) as LibraryDocument | undefined;
    await readDone;
    if (!document) return;
    const writeTransaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
    writeTransaction.objectStore(DOCUMENTS_STORE).put({ ...document, currentPage, totalPages, lastReadAt: Date.now() });
    await transactionDone(writeTransaction);
  } finally {
    database.close();
  }
}

export async function saveLibraryDocumentIndex(id: string, pages: DocumentPageText[]): Promise<LibraryDocument | null> {
  const database = await openDatabase();
  try {
    const readTransaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const readDone = transactionDone(readTransaction);
    const stored = await requestResult(readTransaction.objectStore(DOCUMENTS_STORE).get(id)) as LibraryDocument | undefined;
    await readDone;
    if (!stored) return null;
    const analysis = analyzeDocument(stored.name, pages);
    const updated: LibraryDocument = {
      ...normalizeLibraryDocument(stored),
      ...analysis,
      totalPages: pages.length || stored.totalPages,
      indexedAt: Date.now(),
    };
    const transaction = database.transaction([DOCUMENTS_STORE, INDEXES_STORE], 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).put(updated);
    transaction.objectStore(INDEXES_STORE).put({ id, pages, references: parseReferenceEntries(pages), updatedAt: Date.now() } satisfies StoredDocumentIndex);
    await transactionDone(transaction);
    return updated;
  } finally {
    database.close();
  }
}

export async function loadLibraryDocumentIndex(id: string): Promise<DocumentPageText[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INDEXES_STORE, 'readonly');
    const done = transactionDone(transaction);
    const stored = await requestResult(transaction.objectStore(INDEXES_STORE).get(id)) as StoredDocumentIndex | undefined;
    await done;
    return stored?.pages ?? [];
  } finally {
    database.close();
  }
}

export async function loadLibraryDocumentReferences(id: string): Promise<ReferenceEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INDEXES_STORE, 'readonly');
    const done = transactionDone(transaction);
    const stored = await requestResult(transaction.objectStore(INDEXES_STORE).get(id)) as StoredDocumentIndex | undefined;
    await done;
    if (!stored) return [];
    if (stored.references) return stored.references;
    const references = parseReferenceEntries(stored.pages);
    const writeTransaction = database.transaction(INDEXES_STORE, 'readwrite');
    writeTransaction.objectStore(INDEXES_STORE).put({ ...stored, references, updatedAt: Date.now() } satisfies StoredDocumentIndex);
    await transactionDone(writeTransaction);
    return references;
  } finally {
    database.close();
  }
}

export async function updateLibraryDocument(id: string, patch: Partial<Pick<LibraryDocument, 'category' | 'favorite' | 'tags' | 'title'>>): Promise<void> {
  const database = await openDatabase();
  try {
    const readTransaction = database.transaction(DOCUMENTS_STORE, 'readonly');
    const readDone = transactionDone(readTransaction);
    const stored = await requestResult(readTransaction.objectStore(DOCUMENTS_STORE).get(id)) as LibraryDocument | undefined;
    await readDone;
    if (!stored) return;
    const transaction = database.transaction(DOCUMENTS_STORE, 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).put({ ...normalizeLibraryDocument(stored), ...patch });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function removeLibraryDocument(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE, INDEXES_STORE], 'readwrite');
    transaction.objectStore(DOCUMENTS_STORE).delete(id);
    transaction.objectStore(FILES_STORE).delete(id);
    transaction.objectStore(INDEXES_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function pruneLibrary() {
  const documents = await listLibraryDocuments();
  await Promise.all(documents.slice(MAX_SAVED_DOCUMENTS).map((document) => removeLibraryDocument(document.id)));
}

function normalizeLibraryDocument(document: LibraryDocument): LibraryDocument {
  return {
    ...document,
    title: document.title || titleFromFileName(document.name),
    category: document.category || '未分类',
    tags: Array.isArray(document.tags) ? document.tags : [],
    favorite: Boolean(document.favorite),
  };
}

function titleFromFileName(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || '未命名文献';
}

const CATEGORY_RULES: Array<{ category: PaperCategory; terms: string[] }> = [
  { category: '脑科学与生物信号', terms: ['eeg', 'ecg', 'emg', 'brain computer', 'brain-computer', 'neural signal', 'neuroscience', '脑电', '脑机接口', '神经信号'] },
  { category: '计算机视觉', terms: ['computer vision', 'image segmentation', 'object detection', 'visual recognition', 'diffusion image', '图像分割', '目标检测', '计算机视觉'] },
  { category: '自然语言处理', terms: ['natural language', 'language model', 'llm', 'transformer', 'text generation', 'machine translation', '自然语言', '语言模型', '机器翻译'] },
  { category: '人工智能', terms: ['machine learning', 'deep learning', 'artificial intelligence', 'neural network', 'reinforcement learning', '机器学习', '深度学习', '人工智能', '神经网络'] },
  { category: '医学与生命科学', terms: ['clinical', 'patient', 'disease', 'biomedical', 'medical', 'protein', 'genome', '医学', '临床', '疾病', '蛋白质', '基因'] },
  { category: '工程与机器人', terms: ['robot', 'control system', 'sensor', 'hardware', 'mechanical', 'automation', '机器人', '控制系统', '传感器', '硬件'] },
  { category: '材料与物理', terms: ['material', 'quantum', 'semiconductor', 'physics', 'nanostructure', '材料', '量子', '半导体', '物理'] },
  { category: '数据与统计', terms: ['statistical', 'regression', 'time series', 'data mining', 'causal inference', '统计', '回归', '时间序列', '数据挖掘'] },
  { category: '社会科学', terms: ['education', 'psychology', 'economics', 'sociology', 'survey study', '教育', '心理学', '经济学', '社会学'] },
];

function analyzeDocument(fileName: string, pages: DocumentPageText[]): Pick<LibraryDocument, 'title' | 'category' | 'tags'> {
  const sample = `${fileName}\n${pages.slice(0, 4).map((page) => page.text).join('\n')}`.toLocaleLowerCase().slice(0, 24_000);
  const scored = CATEGORY_RULES.map((rule) => ({
    ...rule,
    hits: rule.terms.filter((term) => sample.includes(term.toLocaleLowerCase())),
  })).sort((a, b) => b.hits.length - a.hits.length);
  const best = scored[0];
  const tags = scored.flatMap((rule) => rule.hits).filter((term, index, values) => values.indexOf(term) === index).slice(0, 5);
  return { title: titleFromFileName(fileName), category: best?.hits.length ? best.category : '未分类', tags };
}
