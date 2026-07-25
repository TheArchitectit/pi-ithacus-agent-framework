/**
 * metrics.ts — metrics registry (counters, gauges, histograms) with Prometheus
 * and OTLP text export formats.
 *
 * pi-agnostic: generates export-format text only — NO network push (no
 * PREVENT-ITH-004 annotation needed; the extension layer pushes if desired).
 */

import type { MetricPoint } from './types.js';

/** Registry for tracking metric data points. */
export class MetricsRegistry {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private labelSets = new Map<string, Record<string, string>>();
  private points: MetricPoint[] = [];

  /** Increment a counter. */
  inc(name: string, value = 1, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
    this.labelSets.set(key, labels);
    this.record(name, 'counter', this.counters.get(key)!, labels);
  }

  /** Set a gauge value. */
  set(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.gauges.set(key, value);
    this.labelSets.set(key, labels);
    this.record(name, 'gauge', value, labels);
  }

  /** Observe a histogram value. */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    const arr = this.histograms.get(key) ?? [];
    arr.push(value);
    this.histograms.set(key, arr);
    this.labelSets.set(key, labels);
    this.record(name, 'histogram', value, labels);
  }

  /** Get a counter value. */
  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.key(name, labels)) ?? 0;
  }

  /** Get a gauge value. */
  getGauge(name: string, labels: Record<string, string> = {}): number {
    return this.gauges.get(this.key(name, labels)) ?? 0;
  }

  /** Get histogram observations. */
  getHistogram(name: string, labels: Record<string, string> = {}): number[] {
    return this.histograms.get(this.key(name, labels)) ?? [];
  }

  /** Record task-level duration (helper). */
  recordDuration(taskId: string, ms: number): void {
    this.observe('ithacus_task_duration_ms', ms, { taskId });
  }

  /** Record task-level token usage (helper). */
  recordTokens(taskId: string, tokens: number): void {
    this.inc('ithacus_task_tokens_total', tokens, { taskId });
  }

  /** All recorded points (for export). */
  allPoints(): MetricPoint[] {
    return [...this.points];
  }

  /** Track task duration + tokens (convenience). */
  trackTask(taskId: string, ms: number, tokens: number): void {
    this.recordDuration(taskId, ms);
    this.recordTokens(taskId, tokens);
  }

  /** Export in Prometheus text format. */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of this.counters) {
      const labels = this.labelSets.get(key) ?? {};
      const name = key.split('{')[0];
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${this.formatLabels(labels)} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      const labels = this.labelSets.get(key) ?? {};
      const name = key.split('{')[0];
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${this.formatLabels(labels)} ${value}`);
    }
    for (const [key, values] of this.histograms) {
      const labels = this.labelSets.get(key) ?? {};
      const name = key.split('{')[0];
      lines.push(`# TYPE ${name} histogram`);
      for (const bucket of [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]) {
        const count = values.filter(v => v <= bucket).length;
        lines.push(`${name}_bucket{le="${bucket}"${this.formatLabelsExtra(labels)}} ${count}`);
      }
      lines.push(`${name}_bucket{le="+Inf"${this.formatLabelsExtra(labels)}} ${values.length}`);
      lines.push(`${name}_count${this.formatLabels(labels)} ${values.length}`);
      lines.push(`${name}_sum${this.formatLabels(labels)} ${values.reduce((s, v) => s + v, 0)}`);
    }
    return lines.join('\n') + '\n';
  }

  /** Export in OTLP JSON format (text representation). */
  toOTLP(): string {
    const resourceMetrics = {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'ithacus' } }] },
      scopeMetrics: [{
        scope: { name: 'ithacus' },
        metrics: this.points.map(p => ({
          name: p.name,
          description: '',
          unit: '1',
          ...(p.type === 'counter' ? { sum: { dataPoints: [{ asDouble: p.value, timeUnixNano: String(p.ts * 1e6), attributes: this.toOTLPAttributes(p.labels) }] } } : {}),
          ...(p.type === 'gauge' ? { gauge: { dataPoints: [{ asDouble: p.value, timeUnixNano: String(p.ts * 1e6), attributes: this.toOTLPAttributes(p.labels) }] } } : {}),
          ...(p.type === 'histogram' ? { histogram: { dataPoints: [{ count: 1, sum: p.value, timeUnixNano: String(p.ts * 1e6), attributes: this.toOTLPAttributes(p.labels) }] } } : {}),
        })),
      }],
    };
    return JSON.stringify(resourceMetrics, null, 2);
  }

  private record(name: string, type: MetricPoint['type'], value: number, labels: Record<string, string>): void {
    this.points.push({ name, type, value, labels, ts: Date.now() });
  }

  private key(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort();
    if (entries.length === 0) return '';
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
  }

  private formatLabelsExtra(labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort();
    if (entries.length === 0) return '';
    return ',' + entries.map(([k, v]) => `${k}="${v}"`).join(',');
  }

  private toOTLPAttributes(labels: Record<string, string>): Array<{ key: string; value: { stringValue: string } }> {
    return Object.entries(labels).map(([k, v]) => ({ key: k, value: { stringValue: v } }));
  }

  /** Reset all metrics. */
  clear(): void {
    this.counters.clear(); this.gauges.clear(); this.histograms.clear();
    this.labelSets.clear(); this.points = [];
  }
}

/** Create a fresh registry. */
export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistry();
}
