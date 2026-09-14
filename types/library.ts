export type PaperCategory = '人工智能' | '计算机视觉' | '自然语言处理' | '脑科学与生物信号' | '医学与生命科学' | '工程与机器人' | '材料与物理' | '数据与统计' | '社会科学' | '未分类';

export interface LibraryDocument {
  id: string;
  name: string;
  title: string;
  size: number;
  type: string;
  lastModified: number;
  firstOpenedAt: number;
  lastReadAt: number;
  currentPage: number;
  totalPages: number;
  category: PaperCategory;
  tags: string[];
  favorite: boolean;
  indexedAt?: number;
}

export interface ReferenceEntry {
  id: string;
  number: number;
  raw: string;
  title?: string;
  year?: number;
  doi?: string;
  bibliographyPage: number;
}

export interface ResolvedReference extends ReferenceEntry {
  matchedDocumentId: string | null;
  matchConfidence: number;
}
