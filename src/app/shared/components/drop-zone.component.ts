import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-drop-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
    class: 'block',
  },
  template: `
    <button
      type="button"
      (click)="pick()"
      class="drop group relative flex w-full flex-col items-center justify-center gap-3 rounded-[--radius-lg] border-2 border-dashed px-6 text-center transition-colors"
      [class.border-line-strong]="!dragging()"
      [class.compact]="compact()"
      [style.border-color]="dragging() ? 'var(--accent)' : null"
      [style.background]="dragging() ? 'var(--accent-soft)' : null"
    >
      <div
        class="grid place-items-center rounded-full transition-transform group-hover:scale-105"
        [class.size-14]="!compact()"
        [class.size-11]="compact()"
        [style.background]="'var(--accent-soft)'"
        [style.color]="'var(--accent-soft-fg)'"
      >
        <app-icon name="cloud-upload" [size]="compact() ? 20 : 26" />
      </div>
      <div>
        <div class="font-medium" [class.text-sm]="compact()">
          {{ dragging() ? 'Drop to upload' : label() }}
        </div>
        <div class="mt-0.5 text-xs text-subtle">{{ hint() }}</div>
      </div>
    </button>
  `,
  styles: `
    .drop {
      min-height: 11rem;
    }
    .drop.compact {
      min-height: 7rem;
    }
  `,
})
export class DropZoneComponent {
  readonly label = input('Drag & drop files here');
  readonly hint = input('or click to browse');
  readonly accept = input('');
  readonly compact = input(false);
  readonly filesDropped = output<File[]>();

  protected readonly dragging = signal(false);

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }
  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
  }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) this.filesDropped.emit(files);
  }

  pick(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (this.accept()) input.accept = this.accept();
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      if (files.length) this.filesDropped.emit(files);
    });
    input.click();
  }
}
