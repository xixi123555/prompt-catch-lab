/**
 * 控制台报告：明细表 + 缓存影响判定 + 总量汇总。
 * 判定逻辑单独导出，便于单测；终端只负责排版。
 */
import { displayWidth, renderTable } from './table.js';
import { PROVIDER_LABELS, SAMPLE_LABELS } from './labels.js';
import type { ProviderReport, ScenarioResult, Usage } from './types.js';

export type VerdictKind = 'intact' | 'partial' | 'broken' | 'invalid';

export interface Verdict {
  kind: VerdictKind;
  /** 一句话结论 */
  label: string;
}

/**
 * 比较"对照命中"与"变体命中"，给出改动点对缓存的影响。
 * 阈值说明：控制请求与基线请求本应完全一致，留 1% 容差应对厂商侧的块对齐抖动。
 */
export function judgeCacheImpact(controlHit: number, variantHit: number): Verdict {
  if (controlHit <= 0) {
    return { kind: 'invalid', label: '对照组未命中，本次数据不可用' };
  }
  const ratio = variantHit / controlHit;
  if (ratio >= 0.99) {
    return { kind: 'intact', label: '前缀完整保留（改动点在缓存前缀之外）' };
  }
  if (ratio <= 0.001) {
    return { kind: 'broken', label: '整段失效（改动点在最前端）' };
  }
  return { kind: 'partial', label: `部分失效（保留 ${(ratio * 100).toFixed(0)}%）` };
}

const n = (value: number): string => value.toLocaleString('en-US');
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** 把一次场景的三个采样拆成 control / variant 两个数 */
function pickSamples(result: ScenarioResult): { control?: Usage; variant?: Usage } {
  return {
    control: result.samples.find((s) => s.label === 'control')?.usage,
    variant: result.samples.find((s) => s.label === 'variant')?.usage,
  };
}

function headline(text: string, width = 96): string[] {
  const bar = '═'.repeat(Math.max(8, width - displayWidth(text) - 3));
  return [`${text} ${bar}`];
}

/** 打印一个 API 形态的完整报告 */
export function printProviderReport(report: ProviderReport): void {
  const lines: string[] = [];

  lines.push(...headline(`【${PROVIDER_LABELS[report.provider]}】模型 ${report.model}`));
  lines.push(`端点：${report.baseUrl}`);
  lines.push('');

  // 明细：每个场景三行采样
  const detailRows: string[][] = [];
  for (const result of report.scenarios) {
    if (result.error) {
      detailRows.push([result.label, result.changePoint, '全部', '—', '—', '—', '失败', '—']);
      continue;
    }
    for (const sample of result.samples) {
      const usage = sample.usage;
      detailRows.push([
        result.label,
        result.changePoint,
        SAMPLE_LABELS[sample.label],
        n(usage.promptTokens),
        n(usage.cacheReadTokens),
        n(usage.cacheWriteTokens),
        n(usage.outputTokens),
        pct(usage.cacheHitRate),
        `${sample.latencyMs}ms`,
      ]);
    }
  }

  lines.push(
    ...renderTable(
      ['场景', '改动点', '请求', '输入token', '命中缓存', '写入缓存', '输出', '命中率', '耗时'],
      detailRows,
      ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
    ),
  );
  lines.push('');

  // 判定：变体命中 vs 对照命中
  lines.push('缓存影响判定（以「对照」请求的命中量为基准）');
  const verdictRows: string[][] = [];
  for (const result of report.scenarios) {
    if (result.error) {
      verdictRows.push([result.label, '—', '—', '—', `调用失败：${result.error}`]);
      continue;
    }
    const { control, variant } = pickSamples(result);
    if (!control || !variant) {
      verdictRows.push([result.label, '—', '—', '—', '采样不完整']);
      continue;
    }
    const verdict = judgeCacheImpact(control.cacheReadTokens, variant.cacheReadTokens);
    verdictRows.push([
      result.label,
      n(control.cacheReadTokens),
      n(variant.cacheReadTokens),
      n(variant.cacheReadTokens - control.cacheReadTokens),
      verdict.label,
    ]);
  }
  lines.push(
    ...renderTable(['场景', '对照命中', '变体命中', '差值', '结论'], verdictRows, [
      'left',
      'right',
      'right',
      'right',
      'left',
    ]),
  );
  lines.push('');

  // 汇总
  const all = report.scenarios.flatMap((r) => r.samples);
  const sum = (pick: (u: Usage) => number): number =>
    all.reduce((acc, sample) => acc + pick(sample.usage), 0);
  const totalPrompt = sum((u) => u.promptTokens);
  const totalHit = sum((u) => u.cacheReadTokens);
  const totalWrite = sum((u) => u.cacheWriteTokens);
  const totalOut = sum((u) => u.outputTokens);
  const totalAll = sum((u) => u.totalTokens);

  lines.push('本形态合计');
  lines.push(
    ...renderTable(
      ['请求数', '输入token', '命中缓存', '写入缓存', '输出token', '总消耗token', '整体命中率'],
      [
        [
          n(all.length),
          n(totalPrompt),
          n(totalHit),
          n(totalWrite),
          n(totalOut),
          n(totalAll),
          totalPrompt === 0 ? '—' : pct(totalHit / totalPrompt),
        ],
      ],
      ['right', 'right', 'right', 'right', 'right', 'right', 'right'],
    ),
  );
  lines.push('');

  console.log(lines.join('\n'));
}

/** 打印某形态整体失败的说明 */
export function printProviderFailure(provider: string, message: string): void {
  console.log([...headline(`【${provider}】运行失败`), message, ''].join('\n'));
}
