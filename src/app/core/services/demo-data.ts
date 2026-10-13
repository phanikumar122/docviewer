import type { DbService } from './db.service';
import type { ActivityEvent, DocFile, DocFolder } from '../models';
import { detectKind, extensionOf } from '../models';
import { uid } from '../../shared/util/format';

/**
 * Seed the library with a handful of *real* sample documents (actual PDF / text
 * / CSV / SVG blobs) so first-run users can immediately open viewers and try
 * tools. Everything here is flagged `isDemo: true` so the UI can label it.
 */
export async function seedDemoData(
  db: DbService,
): Promise<{ files: DocFile[]; folders: DocFolder[] }> {
  const now = Date.now();
  const day = 86_400_000;

  const folders: DocFolder[] = [
    { id: 'demo-work', name: 'Work', parentId: null, createdAt: now - 30 * day, updatedAt: now - 2 * day },
    { id: 'demo-study', name: 'Study', parentId: null, createdAt: now - 25 * day, updatedAt: now - 5 * day },
    { id: 'demo-personal', name: 'Personal', parentId: null, createdAt: now - 20 * day, updatedAt: now - day },
    { id: 'demo-invoices', name: 'Invoices', parentId: 'demo-work', createdAt: now - 15 * day, updatedAt: now - day },
  ];

  const files: DocFile[] = [];
  const blobs: { id: string; blob: Blob }[] = [];

  const add = (
    partial: Partial<DocFile> & { name: string; folderId: string | null },
    blob: Blob,
    openedDaysAgo?: number,
  ) => {
    const id = partial.id ?? uid('demo');
    const file: DocFile = {
      id,
      name: partial.name,
      ext: extensionOf(partial.name),
      mime: blob.type || 'application/octet-stream',
      kind: detectKind(partial.name, blob.type),
      size: blob.size,
      folderId: partial.folderId,
      starred: partial.starred ?? false,
      trashed: false,
      trashedAt: null,
      tags: partial.tags ?? [],
      createdAt: partial.createdAt ?? now - 10 * day,
      updatedAt: partial.updatedAt ?? now - day,
      lastOpenedAt: openedDaysAgo != null ? now - openedDaysAgo * day : null,
      isDemo: true,
    };
    files.push(file);
    blobs.push({ id, blob });
  };

  // --- Markdown welcome guide ---
  add(
    { name: 'Welcome to DocuFlow.md', folderId: null, starred: true, tags: ['guide'], updatedAt: now - 2 * 3600_000 },
    new Blob([WELCOME_MD], { type: 'text/markdown' }),
    0,
  );

  // --- Reading list markdown ---
  add(
    { name: 'Reading List.md', folderId: 'demo-personal', tags: ['notes'] },
    new Blob([READING_MD], { type: 'text/markdown' }),
    3,
  );

  // --- Generated PDFs ---
  add(
    { name: 'Getting Started.pdf', folderId: null, starred: true, updatedAt: now - 4 * 3600_000 },
    await buildPdf('Getting Started with DocuFlow', GETTING_STARTED_PARAGRAPHS),
    1,
  );
  add(
    { name: 'Q3 Report.pdf', folderId: 'demo-work', tags: ['report'] },
    await buildPdf('Q3 Business Review', REPORT_PARAGRAPHS, 3),
    2,
  );

  // --- CSV ---
  add({ name: 'Budget 2026.csv', folderId: 'demo-invoices', tags: ['finance'] }, new Blob([BUDGET_CSV], { type: 'text/csv' }));

  // --- JSON ---
  add({ name: 'project-config.json', folderId: 'demo-study', tags: ['dev'] }, new Blob([CONFIG_JSON], { type: 'application/json' }));

  // --- TXT ---
  add({ name: 'Lecture Notes.txt', folderId: 'demo-study' }, new Blob([LECTURE_TXT], { type: 'text/plain' }), 6);

  // --- SVG image ---
  add({ name: 'logo-mark.svg', folderId: 'demo-personal' }, new Blob([LOGO_SVG], { type: 'image/svg+xml' }));

  // Persist
  await Promise.all(blobs.map((b) => db.putBlob(b.id, b.blob)));
  await db.putFiles(files);
  for (const folder of folders) await db.putFolder(folder);

  // Seed a little activity history
  const activity: ActivityEvent[] = [
    { id: uid('act'), type: 'open', fileName: 'Getting Started.pdf', message: 'Opened Getting Started.pdf', at: now - 3600_000 },
    { id: uid('act'), type: 'upload', fileName: 'Q3 Report.pdf', message: 'Uploaded Q3 Report.pdf', at: now - 2 * day },
    { id: uid('act'), type: 'create', message: 'Created folder "Work"', at: now - 30 * day },
  ];
  for (const a of activity) await db.addActivity(a);

  return { files, folders };
}

async function buildPdf(title: string, paragraphs: string[], pages = 1): Promise<Blob> {
  // Dynamically import pdf-lib so it stays out of the initial bundle; it is only
  // needed on first run when seeding demo data.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('DocuFlow');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = rgb(0.36, 0.3, 0.9);
  const ink = rgb(0.15, 0.16, 0.2);

  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const margin = 56;
    let y = height - margin;

    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: accent });

    if (p === 0) {
      page.drawText(title, { x: margin, y: y - 14, size: 24, font: bold, color: ink });
      y -= 54;
    } else {
      page.drawText(`${title} — page ${p + 1}`, { x: margin, y: y - 10, size: 13, font: bold, color: accent });
      y -= 40;
    }

    const lineHeight = 16;
    const maxWidth = width - margin * 2;
    for (const para of paragraphs) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, 11) > maxWidth) {
          page.drawText(line, { x: margin, y, size: 11, font, color: ink });
          y -= lineHeight;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) {
        page.drawText(line, { x: margin, y, size: 11, font, color: ink });
        y -= lineHeight;
      }
      y -= 8;
    }

    page.drawText(`DocuFlow · page ${p + 1} of ${pages}`, {
      x: margin,
      y: margin - 20,
      size: 9,
      font,
      color: rgb(0.55, 0.56, 0.62),
    });
  }

  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

const WELCOME_MD = `# Welcome to DocuFlow

DocuFlow is an all-in-one document workspace that runs **in your browser**. Your
files are stored locally using IndexedDB — nothing is uploaded to a server.

## What you can do today

- **Upload** any document by dragging it onto the dashboard or the file manager.
- **View** PDFs, images, text, Markdown, JSON, CSV, XML and Word (DOCX) documents.
- **Edit** text documents in the rich-text editor with autosave.
- **Run PDF tools**: merge, split, extract pages, rotate, add page numbers, add
  watermarks, convert images to PDF, extract text, and export pages as images.

## Demo data

The files you see now are *demo documents* (marked with a dot). Delete them any
time from **Settings → Clear data**, or just start uploading your own.

> Tip: press \`Ctrl/Cmd + K\` anywhere to open the command palette.
`;

const READING_MD = `# Reading List

## In progress
- Designing Data-Intensive Applications — *ch. 6*
- The Pragmatic Programmer

## Queue
- A Philosophy of Software Design
- Refactoring (2nd ed.)

## Done
- [x] The Mythical Man-Month
- [x] Clean Architecture
`;

const GETTING_STARTED_PARAGRAPHS = [
  'DocuFlow brings your documents, PDF tools and editors into a single cohesive workspace that works on both desktop and mobile.',
  'This sample PDF was generated in your browser with pdf-lib when the app first loaded. You can open it in the viewer, rotate its pages, add a watermark, split it, or export it as images — all locally.',
  'Everything you do stays on this device. Files are persisted in IndexedDB, and object URLs are cleaned up when you navigate away.',
  'Use the sidebar to explore the file manager, PDF tools, converters and the document editor. The command palette (Ctrl/Cmd + K) is the fastest way to jump around.',
];

const REPORT_PARAGRAPHS = [
  'Executive summary: revenue grew 18% quarter over quarter, driven by expansion in the mid-market segment and improved retention.',
  'Operational highlights included a 12% reduction in processing time and the launch of two new document conversion workflows.',
  'This is placeholder content inside a genuinely generated multi-page PDF, used to demonstrate page navigation, thumbnails and page-level tools.',
  'The following sections would normally contain charts and tables; here they are represented as prose so the document remains lightweight.',
];

const BUDGET_CSV = `Category,Planned,Actual,Variance
Salaries,120000,118500,-1500
Software,24000,25800,1800
Marketing,18000,15200,-2800
Travel,9000,4100,-4900
Office,12000,12750,750
Contingency,6000,0,-6000
`;

const CONFIG_JSON = `{
  "name": "docuflow-project",
  "version": "1.0.0",
  "features": {
    "viewer": true,
    "editor": true,
    "pdfTools": ["merge", "split", "rotate", "watermark"]
  },
  "limits": { "maxFileSizeMb": 150 },
  "theme": "dark"
}
`;

const LECTURE_TXT = `Lecture 7 — Distributed Systems
================================

Key ideas:
- Consistency, availability, partition tolerance (CAP)
- Consensus: Paxos, Raft
- Replication and quorums

Reminder: problem set 3 due next Friday.
`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="36" fill="#5b4ee6"/>
  <path d="M60 56h56a24 24 0 0 1 24 24v64a24 24 0 0 1-24 24H60z" fill="#fff" opacity="0.95"/>
  <rect x="76" y="84" width="48" height="8" rx="4" fill="#5b4ee6"/>
  <rect x="76" y="104" width="48" height="8" rx="4" fill="#8b7cff"/>
  <rect x="76" y="124" width="32" height="8" rx="4" fill="#b4a9ff"/>
</svg>`;
