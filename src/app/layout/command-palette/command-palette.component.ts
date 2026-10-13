import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent, type IconName } from '../../shared/components/icon.component';
import { UiStateService } from '../../core/services/ui-state.service';
import { UploadService } from '../../core/services/upload.service';
import { LibraryService } from '../../core/services/library.service';
import { kindMeta } from '../../core/models';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: string;
  run: () => void;
}

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]" (click)="close()">
      <div class="palette-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div
        class="palette-panel relative w-full max-w-xl overflow-hidden rounded-[--radius-lg] border border-line-strong bg-bg-elevated shadow-[var(--shadow-pop)]"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center gap-3 border-b px-4">
          <app-icon name="search" [size]="18" class="text-subtle" />
          <input
            #search
            type="text"
            [value]="query()"
            (input)="onInput($event)"
            (keydown)="onKey($event)"
            placeholder="Search files, tools and actions…"
            class="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-subtle">esc</kbd>
        </div>

        <div class="max-h-[52vh] overflow-y-auto py-2">
          @if (flat().length === 0) {
            <div class="px-4 py-10 text-center text-sm text-subtle">No matches for “{{ query() }}”.</div>
          }
          @for (group of grouped(); track group.name) {
            <div class="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {{ group.name }}
            </div>
            @for (cmd of group.items; track cmd.id) {
              <button
                type="button"
                (click)="runAt(cmd)"
                (mouseenter)="selected.set(indexOf(cmd))"
                class="flex w-full items-center gap-3 rounded-[--radius-sm] px-3 py-2.5 text-left text-sm"
                [class.bg-surface-2]="indexOf(cmd) === selected()"
              >
                <app-icon [name]="cmd.icon" [size]="17" class="text-muted" />
                <span class="truncate">{{ cmd.label }}</span>
                @if (cmd.hint) {
                  <span class="ml-auto truncate pl-3 text-xs text-subtle">{{ cmd.hint }}</span>
                }
              </button>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .palette-backdrop {
      animation: fade-in 0.15s ease;
    }
    .palette-panel {
      animation: palette-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
    @keyframes palette-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .palette-backdrop,
      .palette-panel {
        animation: none;
      }
    }
  `,
})
export class CommandPaletteComponent {
  private readonly ui = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly upload = inject(UploadService);
  private readonly library = inject(LibraryService);

  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly query = signal('');
  protected readonly selected = signal(0);

  private readonly staticCommands: Command[] = [
    { id: 'nav-dashboard', label: 'Go to Dashboard', icon: 'dashboard', group: 'Navigate', run: () => this.go('/dashboard') },
    { id: 'nav-files', label: 'Go to All Files', icon: 'files', group: 'Navigate', run: () => this.go('/files') },
    { id: 'nav-recent', label: 'Go to Recent', icon: 'clock', group: 'Navigate', run: () => this.go('/recent') },
    { id: 'nav-starred', label: 'Go to Starred', icon: 'star', group: 'Navigate', run: () => this.go('/starred') },
    { id: 'nav-tools', label: 'Go to PDF Tools', icon: 'wrench', group: 'Navigate', run: () => this.go('/tools') },
    { id: 'nav-converters', label: 'Go to Converters', icon: 'arrow-right-left', group: 'Navigate', run: () => this.go('/converters') },
    { id: 'nav-trash', label: 'Go to Trash', icon: 'trash', group: 'Navigate', run: () => this.go('/trash') },
    { id: 'nav-settings', label: 'Go to Settings', icon: 'settings', group: 'Navigate', run: () => this.go('/settings') },
    { id: 'act-upload', label: 'Upload files', hint: 'Import documents', icon: 'upload', group: 'Actions', run: () => { this.close(); void this.upload.pickAndImport(null); } },
    { id: 'act-new-doc', label: 'Create new document', icon: 'file-plus', group: 'Actions', run: () => this.go('/editor') },
    { id: 'tool-merge', label: 'Merge PDFs', icon: 'combine', group: 'Tools', run: () => this.go('/tools/merge') },
    { id: 'tool-split', label: 'Split PDF', icon: 'split', group: 'Tools', run: () => this.go('/tools/split') },
    { id: 'tool-organize', label: 'Organize pages', icon: 'grip', group: 'Tools', run: () => this.go('/tools/organize') },
    { id: 'tool-rotate', label: 'Rotate pages', icon: 'rotate-cw', group: 'Tools', run: () => this.go('/tools/rotate') },
    { id: 'tool-img2pdf', label: 'Images to PDF', icon: 'image-plus', group: 'Tools', run: () => this.go('/tools/images-to-pdf') },
    { id: 'tool-watermark', label: 'Add watermark', icon: 'stamp', group: 'Tools', run: () => this.go('/tools/watermark') },
    { id: 'tool-pagenum', label: 'Add page numbers', icon: 'type', group: 'Tools', run: () => this.go('/tools/page-numbers') },
    { id: 'tool-protect', label: 'Password protect / unlock PDF', icon: 'lock', group: 'Tools', run: () => this.go('/tools/protect') },
    { id: 'tool-pdf2word', label: 'PDF to Word (.docx)', icon: 'file-type', group: 'Tools', run: () => this.go('/tools/pdf-to-word') },
    { id: 'tool-word2pdf', label: 'Word to PDF', icon: 'file-text', group: 'Tools', run: () => this.go('/tools/word-to-pdf') },
    { id: 'tool-excel2pdf', label: 'Excel to PDF', icon: 'table', group: 'Tools', run: () => this.go('/tools/excel-to-pdf') },
    { id: 'tool-pdf2excel', label: 'PDF to Excel (tables)', icon: 'table', group: 'Tools', run: () => this.go('/tools/pdf-to-excel') },
    { id: 'tool-ppt2pdf', label: 'PowerPoint to PDF', icon: 'presentation', group: 'Tools', run: () => this.go('/tools/ppt-to-pdf') },
    { id: 'tool-pdf2ppt', label: 'PDF to PowerPoint', icon: 'presentation', group: 'Tools', run: () => this.go('/tools/pdf-to-ppt') },
    { id: 'tool-ocr', label: 'OCR scanned PDF (make searchable)', icon: 'scan-text', group: 'Tools', run: () => this.go('/tools/ocr') },
    { id: 'tool-edit-sheet', label: 'Edit Spreadsheet (Excel / CSV)', icon: 'table', group: 'Tools', run: () => this.go('/tools/edit-sheet') },
    { id: 'tool-edit-ppt', label: 'Edit Presentation (PowerPoint)', icon: 'presentation', group: 'Tools', run: () => this.go('/tools/edit-ppt') },
  ];

  /** File results matched against the query. */
  private readonly fileCommands = computed<Command[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return [];
    return this.library
      .liveFiles()
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((f) => ({
        id: `file-${f.id}`,
        label: f.name,
        hint: kindMeta(f.kind).label,
        icon: kindMeta(f.kind).icon,
        group: 'Files',
        run: () => this.go(`/viewer/${f.id}`),
      }));
  });

  protected readonly flat = computed<Command[]>(() => {
    const q = this.query().trim().toLowerCase();
    const matched = q
      ? this.staticCommands.filter((c) => (c.label + ' ' + c.group).toLowerCase().includes(q))
      : this.staticCommands;
    return [...this.fileCommands(), ...matched];
  });

  protected readonly grouped = computed(() => {
    const groups = new Map<string, Command[]>();
    for (const cmd of this.flat()) {
      const list = groups.get(cmd.group) ?? [];
      list.push(cmd);
      groups.set(cmd.group, list);
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items }));
  });

  constructor() {
    // Autofocus the input when opened, and reset state.
    effect(() => {
      const el = this.searchEl();
      if (el) setTimeout(() => el.nativeElement.focus(), 0);
    });
    effect(() => {
      // Keep selection within bounds as results change.
      if (this.selected() >= this.flat().length) this.selected.set(0);
    });
  }

  protected indexOf(cmd: Command): number {
    return this.flat().findIndex((c) => c.id === cmd.id);
  }

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
    this.selected.set(0);
  }

  protected onKey(e: KeyboardEvent): void {
    const items = this.flat();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selected.update((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selected.update((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = items[this.selected()];
      if (cmd) this.runAt(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  protected runAt(cmd: Command): void {
    cmd.run();
  }

  protected close(): void {
    this.ui.closeCommandPalette();
    this.query.set('');
    this.selected.set(0);
  }

  private go(route: string): void {
    this.close();
    void this.router.navigateByUrl(route);
  }
}
