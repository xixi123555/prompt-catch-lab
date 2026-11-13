/**
 * OpenAI 形态（/chat/completions）：前缀缓存是自动的，不需要任何标记位；
 * 命中量通过 usage.prompt_cache_hit_tokens 返回（OpenAI 官方对应 prompt_tokens_details.cached_tokens）。
 * 注意：自动缓存没有"写入量"字段，cacheWriteTokens 恒为 0，这不是 bug。
 */
import OpenAI from 'openai';
import type { PromptFixture } from '../fixture.js';
import type { Usage } from '../types.js';
import type { Provider } from './provider.js';
import { makeUsage, readNumber } from '../usage.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function createOpenAIProvider(options: OpenAIProviderOptions): Provider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    maxRetries: 2,
    timeout: 120_000,
  });

  return {
    id: 'openai',
    baseUrl: options.baseUrl,
    model: options.model,
    async send(fixture: PromptFixture, maxTokens: number): Promise<Usage> {
      const response = await client.chat.completions.create({
        model: options.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: fixture.system },
          ...fixture.messages.filter((m) => m.role !== 'system'),
        ],
        tools: fixture.tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      });

      const usage = response.usage;
      if (!usage) throw new Error('OpenAI 形态响应缺少 usage 字段，无法统计缓存');

      return makeUsage({
        promptTokens: usage.prompt_tokens,
        // DeepSeek 扩展字段优先，回退 OpenAI 官方字段
        cacheReadTokens:
          readNumber(usage, 'prompt_cache_hit_tokens') ??
          readNumber(usage, 'prompt_tokens_details', 'cached_tokens') ??
          0,
        cacheWriteTokens: 0,
        outputTokens: usage.completion_tokens ?? 0,
      });
    },
  };
}
