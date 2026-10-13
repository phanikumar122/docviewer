/** Core domain models for DocuFlow. */

export type FileKind =
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'text'
  | 'markdown'
  | 'json'
  | 'xml'
  | 'csv'
  | 'archive'
  | 'other';

/** Metadata record for a stored file. The binary content lives separately
 *  in the `blobs` object store, keyed by the same `id`. */
export interface DocFile {
  id: string;
  name: string;
  ext: string;
  mime: string;
  kind: FileKind;
  size: number;
  folderId: string | null;
  starred: boolean;
  trashed: boolean;
  trashedAt: number | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /** True for seeded sample files so the UI can distinguish them from real uploads. */
  isDemo: boolean;
}

export interface DocFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ActivityType =
  | 'upload'
  | 'open'
  | 'edit'
  | 'convert'
  | 'delete'
  | 'restore'
  | 'create'
  | 'rename'
  | 'star'
  | 'copy'
  | 'tool';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  fileId?: string;
  fileName?: string;
  message: string;
  at: number;
}

/** Autosaved rich-text / editor document, keyed by its source file id. */
export interface EditorDoc {
  id: string;
  fileId: string;
  format: 'html' | 'markdown' | 'text';
  content: string;
  updatedAt: number;
}

export type ViewMode = 'grid' | 'list';
export type SortKey = 'name' | 'updatedAt' | 'kind' | 'size';
export type SortDir = 'asc' | 'desc';
