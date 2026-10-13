import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([PieChart, BarChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

/** Thin Apache ECharts wrapper that disposes correctly. */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="h-full w-full"></div>`,
  host: { class: 'block' },
})
export class ChartComponent {
  readonly option = input.required<EChartsCoreOption>();
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect((onCleanup) => {
      const el = this.host().nativeElement;
      this.chart?.dispose();
      this.chart = echarts.init(el, undefined, { renderer: 'canvas' });
      this.chart.setOption(untracked(this.option));

      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
        this.resizeObserver.observe(el);
      }

      onCleanup(() => {
        this.chart?.dispose();
        this.chart = null;
      });
    });

    effect(() => {
      // Update data without recreating when only the option changes.
      const opt = this.option();
      this.chart?.setOption(opt, true);
    });
  }
}
