import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import * as echarts from 'echarts';

/**
 * Thin Apache ECharts wrapper. Renders the given option object, keeps the chart
 * sized to its container, and disposes cleanly.
 */
@Component({
  selector: 'app-echart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="h-full w-full"></div>`,
  host: { class: 'block' },
})
export class EChartComponent {
  readonly option = input.required<echarts.EChartsCoreOption>();

  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly destroyRef = inject(DestroyRef);
  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const option = this.option();
      queueMicrotask(() => this.render(option));
    });

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.chart?.dispose();
    });
  }

  private render(option: echarts.EChartsCoreOption): void {
    const el = this.hostRef().nativeElement;
    if (!this.chart) {
      this.chart = echarts.init(el, undefined, { renderer: 'svg' });
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(el);
    }
    this.chart.setOption(option, true);
  }
}
