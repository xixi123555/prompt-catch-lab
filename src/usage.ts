/**
 * usage 归一化：把两家的字段拼成同一个 Usage 结构，并做基本自洽校验。
 */
import type { Usage } from './types.js';

interface UsageParts {
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export function makeUsage(parts: UsageParts): Usage {
  const promptTokens = Math.max(0, Math.trunc(parts.promptTokens));
  const cacheReadTokens = Math.max(0, Math.trunc(parts.cacheReadTokens));
  const cacheWriteTokens = Math.max(0, Math.trunc(parts.cacheWriteTokens));
  const outputTokens = Math.max(0, Math.trunc(parts.outputTokens));
  return {
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: promptTokens + outputTokens,
    cacheHitRate: promptTokens === 0 ? 0 : cacheReadTokens / promptTokens,
  };
}

/** 从任意对象里按路径安全取数字，兼容厂商扩展字段（如 prompt_cache_hit_tokens） */
export function readNumber(source: unknown, ...path: string[]): number | undefined {
  let cursor: unknown = source;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'number' ? cursor : undefined;
}
