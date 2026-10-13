import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { EChartsCoreOption } from 'echarts';
import { IconComponent, type IconName } from '../../shared/components/icon.component';
import { FileBadgeComponent } from '../../shared/components/file-badge.component';
import { EChartComponent } from '../../shared/components/echart.component';
import { DropZoneComponent } from '../../shared/components/drop-zone.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { LibraryService } from '../../core/services/library.service';
import { UploadService } from '../../core/services/upload.service';
import { kindMeta, type ActivityType, type DocFile } from '../../core/models';
import { formatBytes, relativeTime } from '../../shared/util/format';
import { gsapReveal } from '../../shared/util/animate';

interface QuickTool { title: string; icon: IconName; route: string; }

const ACTIVITY_ICON: Record<ActivityType, IconName> = {
  upload: 'upload', open: 'eye', edit: 'edit', convert: 'arrow-right-left',
  delete: 'trash', restore: 'archive-restore', create: 'folder-plus',
  rename: 'square-pen', star: 'star', tool: 'wrench', copy: 'copy',
};

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, FileBadgeComponent, EChartComponent, DropZoneComponent, EmptyStateComponent],
  templateUrl: './dashboard.component.html',
  host: { class: 'block' },
})
export class DashboardComponent {
  protected readonly library = inject(LibraryService);
  private readonly upload = inject(UploadService);
  private readonly router = inject(Router);
  private readonly el = inject(ElementRef<HTMLElement>);
  protected readonly kindMeta = kindMeta;
  protected readonly relativeTime = relativeTime;
  protected readonly formatBytes = formatBytes;
  protected readonly activityIcon = (t: ActivityType): IconName => ACTIVITY_ICON[t] ?? 'activity';

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });

  protected readonly recent = computed(() => this.library.recentFiles().slice(0, 8));
  protected readonly starred = computed(() => this.library.starredFiles().slice(0, 6));
  protected readonly activity = computed(() => this.library.activity().slice(0, 8));

  protected readonly stats = computed(() => ({
    files: this.library.liveFiles().length,
    size: this.library.totalSize(),
    folders: this.library.folders().length,
    starred: this.library.starredFiles().length,
  }));

  protected readonly quickTools: QuickTool[] = [
    { title: 'Merge PDF', icon: 'combine', route: '/tools/merge' },
    { title: 'Split PDF', icon: 'split', route: '/tools/split' },
    { title: 'Organize', icon: 'grip', route: '/tools/organize' },
    { title: 'Images → PDF', icon: 'image-plus', route: '/tools/images-to-pdf' },
    { title: 'PDF → Text', icon: 'file-text', route: '/tools/extract-text' },
    { title: 'Watermark', icon: 'stamp', route: '/tools/watermark' },
  ];

  /** File-type breakdown by count, for the donut chart. */
  private readonly breakdown = computed(() => {
    const counts = new Map<string, number>();
    for (const f of this.library.liveFiles()) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    return [...counts.entries()].map(([kind, value]) => ({
      name: kindMeta(kind as DocFile['kind']).label,
      value,
      color: kindMeta(kind as DocFile['kind']).color,
    }));
  });

  protected readonly hasFiles = computed(() => this.library.liveFiles().length > 0);

  protected readonly chartOption = computed<EChartsCoreOption>(() => {
    const data = this.breakdown();
    const textColor = '#4c556a';
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: textColor }, icon: 'circle' },
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          data: data.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } })),
        },
      ],
    };
  });

  constructor() {
    // Staggered reveal once data has loaded.
    effect(() => {
      if (this.library.loaded()) {
        queueMicrotask(() => gsapReveal(this.el.nativeElement.querySelectorAll('.reveal')));
      }
    });
  }

  protected onUpload(files: File[]): void {
    void this.upload.importAll(files, null);
  }
  protected pickUpload(): void {
    void this.upload.pickAndImport(null);
  }
  protected newDoc(): void {
    void this.router.navigate(['/editor']);
  }
  protected open(file: DocFile): void {
    void this.router.navigate(['/viewer', file.id]);
  }
}
