import { ChangeDetectionStrategy, Component, effect, inject, signal, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import * as mammoth from 'mammoth';
import { IconComponent } from '../../shared/components/icon.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { sanitizeHtml } from '../../shared/util/sanitize';
import type { DocFile } from '../../core/models';

/**
 * Read-only DOCX preview. Uses mammoth to convert the document to clean HTML
 * (semantic structure: headings, lists, tables), which we then sanitise. This
 * is a faithful *reading* view, not a layout-exact render — complex formatting
 * may differ. Editing requires the dedicated editor / an office engine.
 */
@Component({
  selector: 'app-docx-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SpinnerComponent],
  host: { class: 'flex h-full flex-col' },
  template: `
    <div class="flex items-center gap-2 border-b bg-surface px-4 py-1.5 text-xs text-muted">
      <app-icon name="info" [size]="14" />
      Read-only preview — formatting is approximate. Use “Edit” to open in the editor.
    </div>
    <div class="flex-1 overflow-auto bg-surface-2">
      @if (loading()) {
        <div class="flex items-center justify-center gap-2 py-20 text-sm text-muted"><app-spinner [size]="18" /> Converting document…</div>
      } @else if (error()) {
        <div class="mx-auto max-w-md py-20 text-center text-sm text-danger">{{ error() }}</div>
      } @else {
        <div class="mx-auto my-6 max-w-3xl rounded-[--radius-md] border bg-surface p-10 shadow-[var(--shadow-card)]">
          <article class="prose-doc" [innerHTML]="html()"></article>
        </div>
      }
    </div>
  `,
  styles: `
    .prose-doc { color: var(--fg); line-height: 1.7; }
    .prose-doc :where(h1,h2,h3,h4) { font-weight: 650; margin: 1.3em 0 0.5em; line-height: 1.25; }
    .prose-doc h1 { font-size: 1.7em; }
    .prose-doc h2 { font-size: 1.35em; }
    .prose-doc h3 { font-size: 1.12em; }
    .prose-doc p { margin: 0.7em 0; }
    .prose-doc a { color: var(--accent); text-decoration: underline; }
    .prose-doc ul,.prose-doc ol { margin: 0.6em 0; padding-left: 1.6em; }
    .prose-doc ul { list-style: disc; }
    .prose-doc ol { list-style: decimal; }
    .prose-doc table { border-collapse: collapse; margin: 0.9em 0; width: 100%; }
    .prose-doc th,.prose-doc td { border: 1px solid var(--line); padding: 0.45em 0.7em; }
    .prose-doc img { max-width: 100%; }
  `,
})
export class DocxViewerComponent {
  readonly file = input.required<DocFile>();
  readonly blob = input.required<Blob>();

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly html = signal<SafeHtml>('');

  constructor() {
    effect(() => {
      const blob = this.blob();
      this.loading.set(true);
      this.error.set(null);
      blob
        .arrayBuffer()
        .then((arrayBuffer) => mammoth.convertToHtml({ arrayBuffer }))
        .then((result) => {
          const safe = sanitizeHtml(result.value || '<p><em>This document appears to be empty.</em></p>');
          this.html.set(this.sanitizer.bypassSecurityTrustHtml(safe));
        })
        .catch((e: unknown) => {
          this.error.set(
            `Could not read this Word document. It may use features that aren't supported in the browser preview. (${
              e instanceof Error ? e.message : 'unknown error'
            })`,
          );
        })
        .finally(() => this.loading.set(false));
    });
  }
}
