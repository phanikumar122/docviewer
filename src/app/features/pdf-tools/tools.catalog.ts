import type { IconName } from '../../shared/components/icon.component';

export type ToolCategory = 'organize' | 'convert' | 'edit' | 'optimize' | 'secure';

export interface ToolDef {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  route: string;
  category: ToolCategory;
  /** False for capabilities that honestly require a backend / office engine. */
  implemented: boolean;
  /** Short note shown for not-yet-implemented tools. */
  note?: string;
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  organize: 'Organize',
  convert: 'Convert',
  edit: 'Edit & annotate',
  optimize: 'Optimize',
  secure: 'Security',
};

export const TOOLS: ToolDef[] = [
  // Organize
  { id: 'merge', title: 'Merge PDF', description: 'Combine several PDFs into one document.', icon: 'combine', route: '/tools/merge', category: 'organize', implemented: true },
  { id: 'split', title: 'Split PDF', description: 'Split a PDF into page ranges or single pages.', icon: 'split', route: '/tools/split', category: 'organize', implemented: true },
  { id: 'organize', title: 'Organize pages', description: 'Reorder, extract, duplicate and delete pages.', icon: 'grip', route: '/tools/organize', category: 'organize', implemented: true },
  { id: 'rotate', title: 'Rotate pages', description: 'Rotate individual pages or the whole document.', icon: 'rotate-cw', route: '/tools/rotate', category: 'organize', implemented: true },

  // Convert
  { id: 'images-to-pdf', title: 'Images to PDF', description: 'Turn PNG, JPG, WEBP or GIF images into a PDF.', icon: 'image-plus', route: '/tools/images-to-pdf', category: 'convert', implemented: true },
  { id: 'pdf-to-images', title: 'PDF to Images', description: 'Export each page as a PNG or JPEG image.', icon: 'image', route: '/tools/pdf-to-images', category: 'convert', implemented: true },
  { id: 'extract-text', title: 'PDF to Text', description: 'Extract the text layer from a PDF.', icon: 'file-text', route: '/tools/extract-text', category: 'convert', implemented: true },
  { id: 'pdf-to-docx', title: 'PDF to Word', description: 'Convert a PDF into an editable Word (.docx / .doc) document.', icon: 'file-type', route: '/tools/pdf-to-word', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'docx-to-pdf', title: 'Word to PDF', description: 'Convert a Word (.docx / .doc) document to PDF.', icon: 'file-text', route: '/tools/word-to-pdf', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'excel-to-pdf', title: 'Excel to PDF', description: 'Convert an Excel (.xlsx) workbook to PDF.', icon: 'table', route: '/tools/excel-to-pdf', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'pdf-to-excel', title: 'PDF to Excel', description: 'Extract tables from a PDF into an Excel workbook.', icon: 'table', route: '/tools/pdf-to-excel', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'ppt-to-pdf', title: 'PowerPoint to PDF', description: 'Convert a PowerPoint (.pptx / .ppt) deck to PDF.', icon: 'presentation', route: '/tools/ppt-to-pdf', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'pdf-to-ppt', title: 'PDF to PowerPoint', description: 'Turn each PDF page into an editable PowerPoint (.pptx) slide.', icon: 'presentation', route: '/tools/pdf-to-ppt', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'ocr', title: 'OCR scanned PDF', description: 'Make a scanned PDF searchable with a text layer.', icon: 'scan-text', route: '/tools/ocr', category: 'convert', implemented: true, note: 'Uses the local engine (pnpm engine)' },

  // Edit
  { id: 'edit-pdf', title: 'Edit PDF', description: 'Click text to edit it in place, reflow paragraphs, cover & restamp, draw, add images.', icon: 'square-pen', route: '/tools/edit', category: 'edit', implemented: true },
  { id: 'edit-sheet', title: 'Edit Spreadsheet', description: 'Open an Excel/CSV file, edit cells in a grid, save back.', icon: 'table', route: '/tools/edit-sheet', category: 'edit', implemented: true },
  { id: 'edit-ppt', title: 'Edit Presentation', description: 'Edit slide text, reorder or delete slides in a .pptx.', icon: 'presentation', route: '/tools/edit-ppt', category: 'edit', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'page-numbers', title: 'Add page numbers', description: 'Stamp page numbers in a chosen position.', icon: 'type', route: '/tools/page-numbers', category: 'edit', implemented: true },
  { id: 'watermark', title: 'Add watermark', description: 'Overlay a text watermark on every page.', icon: 'stamp', route: '/tools/watermark', category: 'edit', implemented: true },

  // Optimize
  { id: 'compress', title: 'Compress / optimise', description: 'Re-save and strip unused objects to shrink size.', icon: 'weight', route: '/tools/compress', category: 'optimize', implemented: true },

  // Secure
  { id: 'protect', title: 'Password protect', description: 'Encrypt a PDF with a password & permissions, or remove one.', icon: 'lock', route: '/tools/protect', category: 'secure', implemented: true, note: 'Uses the local engine (pnpm engine)' },
  { id: 'inspect', title: 'Inspect permissions', description: 'View encryption and metadata of a PDF.', icon: 'shield', route: '/tools/extract-text', category: 'secure', implemented: false, note: 'Shown in the viewer’s info panel' },
];

export function toolsByCategory(category: ToolCategory): ToolDef[] {
  return TOOLS.filter((t) => t.category === category);
}
