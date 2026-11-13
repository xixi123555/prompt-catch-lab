/**
 * 运行配置：环境变量 + 命令行参数。
 * 密钥来源优先级：环境变量（含 .env.local 注入）→ 控制台交互输入。
 * 任何情况下都不把密钥写进代码或提交进仓库。
 */
import { parseArgs } from 'node:util';
import { promptSecret } from './prompt.js';
import type { ProviderId } from './types.js';

export interface Config {
  /** 要测的 API 形态；both 表示两个都跑 */
  provider: 'openai' | 'anthropic' | 'both';
  model: string;
  /** 两次请求之间的间隔，毫秒。厂商的缓存在首次请求后是异步落盘的，需要留时间 */
  gapMs: number;
  /** 只跑指定场景 id；空数组代表全跑 */
  onlyScenarios: string[];
  /** Anthropic 形态是否显式打 cache_control 断点（真 Anthropic 必须，DeepSeek 忽略） */
  explicitCacheControl: boolean;
  apiKey: string;
  baseUrls: Record<ProviderId, string>;
  maxTokens: number;
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';

/** 从环境变量取密钥：DEEPSEEK_API_KEY 优先，回退 DEEPSEEK_FLASH_KEY；都没有返回 undefined */
export function pickApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.DEEPSEEK_API_KEY?.trim() || env.DEEPSEEK_FLASH_KEY?.trim();
  return key ? key : undefined;
}

/** 校验并规整手输的密钥；空值直接报错，避免带着空 key 去打接口 */
export function normalizeApiKey(raw: string): string {
  const key = raw.trim();
  if (key === '') {
    throw new Error('API 密钥不能为空');
  }
  return key;
}

/** 非交互场景（管道 / CI）时从标准输入读一行 */
async function readLineFromStdin(): Promise<string | undefined> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin });
  try {
    for await (const line of rl) {
      return line;
    }
    return undefined;
  } finally {
    rl.close();
  }
}

/**
 * 解析密钥：先看环境变量，没有就在控制台要求输入（输入打码）。
 * @throws 非交互终端下读不到内容，或用户取消输入
 */
async function resolveApiKey(): Promise<string> {
  const fromEnv = pickApiKeyFromEnv();
  if (fromEnv) return fromEnv;

  console.log('未找到 API 密钥（DEEPSEEK_API_KEY / DEEPSEEK_FLASH_KEY 都未设置）。');
  console.log('也可以退出后在 .env.local 里配置，或用 Ctrl-C 取消。');
  const typed = await promptSecret('请输入 API 密钥（输入内容会打码）：', readLineFromStdin);
  return normalizeApiKey(typed);
}

export async function loadConfig(argv: string[] = process.argv.slice(2)): Promise<Config> {
  const { values } = parseArgs({
    args: argv,
    options: {
      provider: { type: 'string', default: 'both' },
      model: { type: 'string', default: process.env.MODEL ?? 'deepseek-flash' },
      gap: { type: 'string', default: '2000' },
      scenario: { type: 'string', default: '' },
      'no-cache-control': { type: 'boolean', default: false },
      'max-tokens': { type: 'string', default: '8' },
    },
    allowPositionals: false,
  });

  const provider = values.provider as Config['provider'];
  if (!['openai', 'anthropic', 'both'].includes(provider)) {
    throw new Error(`--provider 只能是 openai / anthropic / both，收到：${values.provider}`);
  }

  const gapMs = Number(values.gap);
  if (!Number.isFinite(gapMs) || gapMs < 0) {
    throw new Error(`--gap 必须是非负数毫秒，收到：${values.gap}`);
  }

  const maxTokens = Number(values['max-tokens']);
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error(`--max-tokens 必须是正整数，收到：${values['max-tokens']}`);
  }

  const onlyScenarios = (values.scenario ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    provider,
    model: values.model as string,
    gapMs,
    onlyScenarios,
    explicitCacheControl: !values['no-cache-control'],
    apiKey: await resolveApiKey(),
    baseUrls: {
      openai: process.env.DEEPSEEK_OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
      anthropic: process.env.DEEPSEEK_ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL,
    },
    maxTokens,
  };
}
