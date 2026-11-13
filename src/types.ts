/**
 * 全局类型定义。
 * 两家的 usage 字段名不同（OpenAI: prompt_cache_hit_tokens；Anthropic: cache_read_input_tokens），
 * 这里统一归一化成同一组数字，报告层只认 Usage，不再关心厂商差异。
 */

/** 支持的 API 形态 */
export type ProviderId = 'openai' | 'anthropic';

/** 一次请求的用量（已归一化） */
export interface Usage {
  /** 输入侧总 token（含命中缓存的部分） */
  promptTokens: number;
  /** 命中缓存的输入 token */
  cacheReadTokens: number;
  /** 本次新写入缓存的 token（OpenAI 自动缓存不回传，恒为 0） */
  cacheWriteTokens: number;
  /** 输出 token */
  outputTokens: number;
  /** 输入 + 输出 */
  totalTokens: number;
  /** 命中率 = cacheReadTokens / promptTokens，0~1 */
  cacheHitRate: number;
}

/** 一次采样的结果 */
export interface Sample {
  /** warm（播种）/ control（对照组重复）/ variant（变体） */
  label: 'warm' | 'control' | 'variant';
  usage: Usage;
  latencyMs: number;
}

/** 一个场景的采样结果 */
export interface ScenarioResult {
  scenarioId: string;
  /** 中文场景名，报告里直接展示 */
  label: string;
  description: string;
  /** 变体相对基线的唯一改动点，报告里用来解释命中下降的原因 */
  changePoint: string;
  samples: Sample[];
  /** 请求失败时记录原因，报告层展示为失败行而不是中断整轮实验 */
  error?: string;
}

/** 整个 provider 维度的运行结果 */
export interface ProviderReport {
  provider: ProviderId;
  /** 实际请求的端点，便于排错 */
  baseUrl: string;
  model: string;
  scenarios: ScenarioResult[];
}
