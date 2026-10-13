import type { FileKind } from './document.model';
import type { IconName } from '../../shared/components/icon.component';

/** Visual + capability metadata for each file kind. */
export interface KindMeta {
  kind: FileKind;
  label: string;
  icon: IconName;
  /** Tailwind-ish accent used in badges; references CSS color-mix for theme safety. */
  color: string;
  /** True when DocuFlow ships a real in-app viewer for this kind. */
  hasViewer: boolean;
  /** True when DocuFlow ships a real in-app editor for this kind. */
  hasEditor: boolean;
}

export const KIND_META: Record<FileKind, KindMeta> = {
  pdf: { kind: 'pdf', label: 'PDF', icon: 'file-text', color: '#ef4d6b', hasViewer: true, hasEditor: true },
  word: { kind: 'word', label: 'Word', icon: 'file-text', color: '#3b82f6', hasViewer: true, hasEditor: true },
  spreadsheet: { kind: 'spreadsheet', label: 'Spreadsheet', icon: 'spreadsheet', color: '#10b981', hasViewer: true, hasEditor: false },
  presentation: { kind: 'presentation', label: 'Presentation', icon: 'presentation', color: '#f59e0b', hasViewer: false, hasEditor: false },
  image: { kind: 'image', label: 'Image', icon: 'image', color: '#a855f7', hasViewer: true, hasEditor: false },
  text: { kind: 'text', label: 'Text', icon: 'file', color: '#94a3b8', hasViewer: true, hasEditor: true },
  markdown: { kind: 'markdown', label: 'Markdown', icon: 'file-code', color: '#06b6d4', hasViewer: true, hasEditor: true },
  json: { kind: 'json', label: 'JSON', icon: 'file-json', color: '#eab308', hasViewer: true, hasEditor: true },
  xml: { kind: 'xml', label: 'XML', icon: 'file-code', color: '#f97316', hasViewer: true, hasEditor: true },
  csv: { kind: 'csv', label: 'CSV', icon: 'table', color: '#22c55e', hasViewer: true, hasEditor: false },
  archive: { kind: 'archive', label: 'Archive', icon: 'file-archive', color: '#b0975f', hasViewer: false, hasEditor: false },
  other: { kind: 'other', label: 'File', icon: 'file', color: '#94a3b8', hasViewer: false, hasEditor: false },
};

const EXT_TO_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'csv',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  bmp: 'image',
  txt: 'text',
  log: 'text',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  xml: 'xml',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
};

const MIME_TO_KIND: { test: RegExp; kind: FileKind }[] = [
  { test: /^application\/pdf$/, kind: 'pdf' },
  { test: /wordprocessingml|msword|opendocument\.text|rtf/, kind: 'word' },
  { test: /spreadsheetml|ms-excel|opendocument\.spreadsheet/, kind: 'spreadsheet' },
  { test: /^text\/csv$/, kind: 'csv' },
  { test: /presentationml|ms-powerpoint|opendocument\.presentation/, kind: 'presentation' },
  { test: /^image\//, kind: 'image' },
  { test: /^application\/json$/, kind: 'json' },
  { test: /xml$/, kind: 'xml' },
  { test: /^text\/markdown$/, kind: 'markdown' },
  { test: /zip|x-7z|x-rar|x-tar|gzip/, kind: 'archive' },
  { test: /^text\//, kind: 'text' },
];

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Detect file kind from extension first, falling back to MIME. We never trust a
 * single signal blindly: extension drives the UI, MIME is a corroborating check.
 */
export function detectKind(name: string, mime = ''): FileKind {
  const ext = extensionOf(name);
  if (ext && EXT_TO_KIND[ext]) return EXT_TO_KIND[ext];
  const m = MIME_TO_KIND.find((r) => r.test.test(mime));
  return m ? m.kind : 'other';
}

export function kindMeta(kind: FileKind): KindMeta {
  return KIND_META[kind];
}
