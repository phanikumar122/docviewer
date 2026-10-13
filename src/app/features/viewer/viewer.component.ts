import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon.component';
import { FileBadgeComponent } from '../../shared/components/file-badge.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { PdfViewerComponent } from './pdf-viewer.component';
import { ImageViewerComponent } from './image-viewer.component';
import { TextViewerComponent } from './text-viewer.component';
import { DocxViewerComponent } from './docx-viewer.component';
import { SheetViewerComponent } from './sheet-viewer.component';
import { LibraryService } from '../../core/services/library.service';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { kindMeta, type DocFile } from '../../core/models';
import { formatBytes, formatDateTime } from '../../shared/util/format';

const EDITABLE = new Set(['text', 'markdown', 'json', 'xml', 'word']);

@Component({
  selector: 'app-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    FileBadgeComponent,
    SpinnerComponent,
    EmptyStateComponent,
    PdfViewerComponent,
    ImageViewerComponent,
    TextViewerComponent,
    DocxViewerComponent,
    SheetViewerComponent,
  ],
  templateUrl: './viewer.component.html',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class ViewerComponent {
  readonly id = input.required<string>();

  private readonly library = inject(LibraryService);
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly kindMeta = kindMeta;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDateTime = formatDateTime;

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  protected readonly file = computed<DocFile | undefined>(() => this.library.fileById(this.id()));
  protected readonly blob = signal<Blob | null>(null);
  protected readonly loadError = signal(false);
  protected readonly showInfo = signal(false);
  protected readonly fullscreen = signal(false);
  protected readonly pdfInfo = signal<{ pageCount: number; encrypted: boolean; title?: string; producer?: string } | null>(null);

  protected readonly editable = computed(() => {
    const f = this.file();
    return !!f && EDITABLE.has(f.kind);
  });

  protected readonly canViewInApp = computed(() => {
    const f = this.file();
    return !!f && kindMeta(f.kind).hasViewer;
  });

  private lastOpened = '';

  constructor() {
    // Load the blob whenever the target file changes.
    effect(() => {
      const f = this.file();
      this.blob.set(null);
      this.loadError.set(false);
      this.pdfInfo.set(null);
      if (!f) return;
      if (this.lastOpened !== f.id) {
        this.lastOpened = f.id;
        void this.library.markOpened(f.id);
      }
      this.library
        .getBlob(f.id)
        .then((b) => {
          if (!b) { this.loadError.set(true); return; }
          this.blob.set(b);
          if (f.kind === 'pdf') void this.inspectPdf(b);
        })
        .catch(() => this.loadError.set(true));
    });

    const onFs = () => this.fullscreen.set(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    this.destroyRef.onDestroy(() => document.removeEventListener('fullscreenchange', onFs));
  }

  private async inspectPdf(blob: Blob): Promise<void> {
    try {
      const info = await this.pdf.inspect(await blob.arrayBuffer());
      this.pdfInfo.set(info);
    } catch { /* ignore */ }
  }

  protected back(): void {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/files']);
  }

  protected edit(): void {
    void this.router.navigate(['/editor', this.id()]);
  }

  protected editPdf(): void {
    void this.router.navigate(['/tools/edit', this.id()]);
  }

  protected async download(): Promise<void> {
    const f = this.file();
    const b = this.blob();
    if (!f || !b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected print(): void {
    const b = this.blob();
    const f = this.file();
    if (!b || !f) return;
    const url = URL.createObjectURL(b);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    document.body.appendChild(iframe);
  }

  protected toggleFullscreen(): void {
    const el = this.body()?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => this.toast.error('Fullscreen unavailable'));
  }

  protected toggleInfo(): void {
    this.showInfo.update((v) => !v);
  }
}
