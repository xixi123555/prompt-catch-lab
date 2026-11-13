/**
 * 场景运行器：一个场景固定发三次请求
 *   warm    —— 冷启动，把前缀写进缓存
 *   control —— 与 warm 完全相同，作为"本该命中"的对照基线
 *   variant —— 只在一处做改动，用它的命中量与 control 对比
 * 两次请求之间必须留间隔：厂商的缓存落盘是异步的，间隔太短会连续 miss。
 */
import { buildBaseFixture } from './fixture.js';
import type { Provider } from './providers/index.js';
import type { Scenario } from './scenarios.js';
import type { Sample, ScenarioResult } from './types.js';

export interface RunOptions {
  gapMs: number;
  maxTokens: number;
  /** 本次运行的唯一标识，混进 salt 保证每次跑都是真正的冷启动 */
  runNonce: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 带计时的单次请求 */
async function sample(
  provider: Provider,
  fixture: ReturnType<typeof buildBaseFixture>,
  label: Sample['label'],
  options: RunOptions,
): Promise<Sample> {
  const startedAt = performance.now();
  const usage = await provider.send(fixture, options.maxTokens);
  return { label, usage, latencyMs: Math.round(performance.now() - startedAt) };
}

export async function runScenario(
  provider: Provider,
  scenario: Scenario,
  options: RunOptions,
): Promise<ScenarioResult> {
  // salt 里带上 provider 与场景 id：前缀缓存在两个 API 形态之间是共享的（实测），
  // 不带 salt 的话不同形态、不同场景会互相污染命中数。
  const salt = `${provider.id}/${scenario.id}/${options.runNonce}`;
  const build = () => buildBaseFixture(salt);

  const samples: Sample[] = [];
  samples.push(await sample(provider, build(), 'warm', options));
  await sleep(options.gapMs);

  samples.push(await sample(provider, build(), 'control', options));
  await sleep(options.gapMs);

  samples.push(await sample(provider, scenario.mutate(build()), 'variant', options));

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    description: scenario.description,
    changePoint: scenario.changePoint,
    samples,
  };
}
