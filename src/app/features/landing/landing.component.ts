import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, type IconName } from '../../shared/components/icon.component';

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

interface ToolGroup {
  label: string;
  icon: IconName;
  items: string[];
}

/**
 * Marketing landing page shown at `/`. Self-contained (its own nav + footer),
 * no app shell. Emerald "light & airy" premium language. Scroll reveals are
 * IntersectionObserver-driven and collapse under prefers-reduced-motion.
 */
@Component({
  selector: 'app-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
  host: { class: 'block min-h-dvh bg-bg text-fg' },
})
export class LandingComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly mobileOpen = signal(false);
  protected readonly year = new Date().getFullYear();

  protected readonly formats = [
    'PDF', 'Word', 'Excel', 'PowerPoint', 'Images', 'Markdown', 'CSV', 'JSON', 'XML', 'Text',
  ];

  protected readonly features: Feature[] = [
    { icon: 'wrench', title: 'A complete PDF toolkit', body: 'Merge, split, rotate, organize, compress, watermark and number pages without leaving the tab.' },
    { icon: 'book-open', title: 'Read almost anything', body: 'A built-in viewer for PDFs, Office files, images, markdown and structured text.' },
    { icon: 'square-pen', title: 'Edit real PDFs', body: 'Click any line to retype it, white out text, add signatures, shapes and images.' },
    { icon: 'arrow-right-left', title: 'Convert in a click', body: 'PDF to Word, Excel, PowerPoint and back, plus OCR for scanned documents.' },
    { icon: 'shield-check', title: 'Private by default', body: 'Files are processed in your browser and stored locally. Nothing is uploaded.' },
  ];

  protected readonly toolGroups: ToolGroup[] = [
    { label: 'Organize', icon: 'files', items: ['Merge PDF', 'Split PDF', 'Organize pages', 'Rotate pages', 'Compress'] },
    { label: 'Convert', icon: 'arrow-right-left', items: ['PDF to Word', 'Word to PDF', 'Excel to PDF', 'PowerPoint to PDF', 'OCR scanned PDF'] },
    { label: 'Edit', icon: 'square-pen', items: ['Edit PDF text', 'Watermark', 'Page numbers', 'Images to PDF', 'Document editor'] },
    { label: 'Protect', icon: 'lock', items: ['Password protect', 'Unlock PDF', 'Extract text', 'PDF to images', 'Spreadsheet editor'] },
  ];

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const root = this.host.nativeElement as HTMLElement;
      const els = Array.from(root.querySelectorAll('[data-reveal]')) as HTMLElement[];
      if (reduce || !('IntersectionObserver' in window)) {
        els.forEach((el) => el.classList.add('in'));
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              (e.target as HTMLElement).classList.add('in');
              io.unobserve(e.target);
            }
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
      );
      els.forEach((el) => io.observe(el));
      // Safety net: never leave content hidden if the observer never fires.
      const fallback = window.setTimeout(() => els.forEach((el) => el.classList.add('in')), 2600);
      destroyRef.onDestroy(() => {
        clearTimeout(fallback);
        io.disconnect();
      });
    });
  }

  protected toggleMobile(): void {
    this.mobileOpen.update((v) => !v);
  }
  protected closeMobile(): void {
    this.mobileOpen.set(false);
  }
}
