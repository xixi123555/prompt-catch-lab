/**
 * 入口：跑完场景矩阵并把缓存命中情况打到控制台。
 * 用法见 README，典型命令：pnpm cache
 */
import { loadConfig } from './config.js';
import { PROVIDER_LABELS } from './labels.js';
import { createProviders } from './providers/index.js';
import { printProviderFailure, printProviderReport } from './report.js';
import { renderTable } from './table.js';
import { runScenario } from './runner.js';
import { selectScenarios } from './scenarios.js';
import type { ProviderReport, ScenarioResult } from './types.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  const scenarios = selectScenarios(config.onlyScenarios);
  const providers = createProviders(config);

  // 每次运行用唯一 salt，保证三次请求都是真正的冷启动，不受历史缓存干扰
  const runNonce = Date.now().toString(36);

  console.log('提示词缓存影响验证');
  console.log(`模型：${config.model}  请求间隔：${config.gapMs}ms  场景数：${scenarios.length}`);
  console.log(
    `形态：${providers.map((p) => PROVIDER_LABELS[p.id]).join(' + ')}  Anthropic 缓存断点：${
      config.explicitCacheControl ? '显式断点' : '不打断点'
    }`,
  );
  console.log(`本轮 salt：${runNonce}（每次运行唯一，用于隔离历史缓存）`);
  // 中文名给人看，括号里的 id 给命令行参数用
  console.log(`场景：${scenarios.map((s) => `${s.label}(${s.id})`).join('、')}`);
  console.log('');

  const reports: ProviderReport[] = [];
  let failed = 0;

  for (const provider of providers) {
    const results: ScenarioResult[] = [];
    try {
      for (const scenario of scenarios) {
        process.stdout.write(`  采集中：${PROVIDER_LABELS[provider.id]} / ${scenario.label} ... `);
        try {
          const result = await runScenario(provider, scenario, {
            gapMs: config.gapMs,
            maxTokens: config.maxTokens,
            runNonce,
          });
          const control = result.samples.find((s) => s.label === 'control');
          const variant = result.samples.find((s) => s.label === 'variant');
          console.log(
            `对照命中 ${control?.usage.cacheReadTokens ?? 0} / 变体命中 ${
              variant?.usage.cacheReadTokens ?? 0
            }`,
          );
          results.push(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`失败：${message}`);
          results.push({
            scenarioId: scenario.id,
            label: scenario.label,
            description: scenario.description,
            changePoint: scenario.changePoint,
            samples: [],
            error: message,
          });
          failed += 1;
        }
      }
      console.log('');
      const report: ProviderReport = {
        provider: provider.id,
        baseUrl: provider.baseUrl,
        model: provider.model,
        scenarios: results,
      };
      reports.push(report);
      printProviderReport(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      printProviderFailure(PROVIDER_LABELS[provider.id], message);
      failed += 1;
    }
  }

  // 跨形态汇总：一眼看出两家 API 的缓存策略差异
  if (reports.length > 1) {
    console.log('跨形态汇总');
    const rows = reports.map((report) => {
      const samples = report.scenarios.flatMap((r) => r.samples);
      const prompt = samples.reduce((acc, s) => acc + s.usage.promptTokens, 0);
      const hit = samples.reduce((acc, s) => acc + s.usage.cacheReadTokens, 0);
      const total = samples.reduce((acc, s) => acc + s.usage.totalTokens, 0);
      return [
        PROVIDER_LABELS[report.provider],
        String(samples.length),
        prompt.toLocaleString('en-US'),
        hit.toLocaleString('en-US'),
        total.toLocaleString('en-US'),
        prompt === 0 ? '—' : `${((hit / prompt) * 100).toFixed(1)}%`,
      ];
    });
    console.log(
      renderTable(['形态', '请求数', '输入token', '命中缓存', '总消耗token', '命中率'], rows, [
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
      ]).join('\n'),
    );
    console.log('');
  }

  if (failed > 0) {
    console.log(`有 ${failed} 个场景调用失败，详见上方失败行。`);
    process.exitCode = 1;
  }
}

await main();
