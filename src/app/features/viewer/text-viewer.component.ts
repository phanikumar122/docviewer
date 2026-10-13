import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { IconComponent } from '../../shared/components/icon.component';
import { sanitizeHtml } from '../../shared/util/sanitize';
import type { DocFile } from '../../core/models';

type TextMode = 'markdown' | 'json' | 'csv' | 'xml' | 'plain';

@Component({
  selector: 'app-text-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (mode() === 'markdown') {
      <div class="flex items-center gap-1 border-b bg-surface px-3 py-1.5">
        <button type="button" class="btn btn-sm" [style.background]="!raw() ? 'var(--surface-2)' : null" (click)="raw.set(false)">
          <app-icon name="eye" [size]="15" /> Preview
        </button>
        <button type="button" class="btn btn-sm" [style.background]="raw() ? 'var(--surface-2)' : null" (click)="raw.set(true)">
          <app-icon name="file-code" [size]="15" /> Source
        </button>
      </div>
    }

    <div class="flex-1 overflow-auto">
      @if (mode() === 'markdown' && !raw()) {
        <article class="prose-doc mx-auto max-w-3xl px-6 py-8" [innerHTML]="renderedMd()"></article>
      } @else if (mode() === 'csv') {
        <div class="overflow-auto p-4">
          <table class="w-full border-collapse text-sm">
            <tbody>
              @for (row of csvRows(); track $index; let ri = $index) {
                <tr class="border-b" [class.font-semibold]="ri === 0" [class.bg-surface-2]="ri === 0">
                  @for (cell of row; track $index) {
                    <td class="whitespace-nowrap border-r px-3 py-1.5">{{ cell }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <pre class="overflow-auto p-4 font-mono text-xs leading-relaxed">{{ display() }}</pre>
      }
    </div>
  `,
  styles: `
    .prose-doc { color: var(--fg); line-height: 1.7; }
    .prose-doc :where(h1,h2,h3,h4) { font-weight: 650; margin: 1.4em 0 0.5em; line-height: 1.25; }
    .prose-doc h1 { font-size: 1.6em; }
    .prose-doc h2 { font-size: 1.3em; }
    .prose-doc h3 { font-size: 1.1em; }
    .prose-doc p { margin: 0.7em 0; }
    .prose-doc a { color: var(--accent); text-decoration: underline; }
    .prose-doc code { background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
    .prose-doc pre { background: var(--surface-2); padding: 1em; border-radius: 8px; overflow:auto; }
    .prose-doc pre code { background: none; padding: 0; }
    .prose-doc ul,.prose-doc ol { margin: 0.6em 0; padding-left: 1.5em; }
    .prose-doc ul { list-style: disc; }
    .prose-doc ol { list-style: decimal; }
    .prose-doc blockquote { border-left: 3px solid var(--accent); padding-left: 1em; color: var(--fg-muted); margin: 0.8em 0; }
    .prose-doc table { border-collapse: collapse; margin: 0.8em 0; }
    .prose-doc th,.prose-doc td { border: 1px solid var(--line); padding: 0.4em 0.7em; }
    .prose-doc hr { border: none; border-top: 1px solid var(--line); margin: 1.5em 0; }
    .prose-doc img { max-width: 100%; border-radius: 8px; }
  `,
})
export class TextViewerComponent {
  readonly file = input.required<DocFile>();
  readonly blob = input.required<Blob>();

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly text = signal('');
  protected readonly raw = signal(false);
  protected readonly renderedMd = signal<SafeHtml>('');

  protected readonly mode = computed<TextMode>(() => {
    const k = this.file().kind;
    if (k === 'markdown') return 'markdown';
    if (k === 'json') return 'json';
    if (k === 'csv') return 'csv';
    if (k === 'xml') return 'xml';
    return 'plain';
  });

  protected readonly display = computed(() => {
    const t = this.text();
    if (this.mode() === 'json') {
      try {
        return JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        return t;
      }
    }
    return t;
  });

  protected readonly csvRows = computed(() => (this.mode() === 'csv' ? parseCsv(this.text()) : []));

  constructor() {
    effect(() => {
      const blob = this.blob();
      blob.text().then(async (t) => {
        this.text.set(t);
        if (this.file().kind === 'markdown') {
          const html = await marked.parse(t);
          this.renderedMd.set(this.sanitizer.bypassSecurityTrustHtml(sanitizeHtml(html)));
        }
      });
    });
  }
}

/** Minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
