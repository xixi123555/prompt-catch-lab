/**
 * Anthropic 形态（/v1/messages）：命中量在 usage.cache_read_input_tokens，
 * 新建缓存在 usage.cache_creation_input_tokens，input_tokens 只统计未命中部分，
 * 所以"输入总量"= input + cache_read + cache_creation（与 OpenAI 的 prompt_tokens 口径对齐）。
 *
 * 关于 cache_control：真 Anthropic 必须显式打断点才会建缓存，DeepSeek 的兼容端点则会自动缓存、
 * 断点被忽略。这里默认打上断点，保证换成官方端点时实验仍然成立。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { PromptFixture } from '../fixture.js';
import type { Usage } from '../types.js';
import type { Provider } from './provider.js';
import { makeUsage, readNumber } from '../usage.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 是否在 system 与最后一个 tool 上打 ephemeral 断点 */
  explicitCacheControl: boolean;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): Provider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    maxRetries: 2,
    timeout: 120_000,
  });

  return {
    id: 'anthropic',
    baseUrl: options.baseUrl,
    model: options.model,
    async send(fixture: PromptFixture, maxTokens: number): Promise<Usage> {
      const breakpoint = options.explicitCacheControl ? { type: 'ephemeral' as const } : undefined;

      const tools = fixture.tools.map((tool, index) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Tool['input_schema'],
        // 断点打在最后一个工具上，等于把 tools 整段纳入可缓存前缀
        ...(breakpoint && index === fixture.tools.length - 1 ? { cache_control: breakpoint } : {}),
      }));

      const response = await client.messages.create({
        model: options.model,
        max_tokens: maxTokens,
        system: [
          {
            type: 'text',
            text: fixture.system,
            ...(breakpoint ? { cache_control: breakpoint } : {}),
          },
        ],
        tools,
        messages: fixture.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      });

      const usage = response.usage;
      if (!usage) throw new Error('Anthropic 形态响应缺少 usage 字段，无法统计缓存');

      const cacheReadTokens = readNumber(usage, 'cache_read_input_tokens') ?? 0;
      const cacheWriteTokens = readNumber(usage, 'cache_creation_input_tokens') ?? 0;
      const inputTokens = readNumber(usage, 'input_tokens') ?? 0;

      return makeUsage({
        promptTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens: readNumber(usage, 'output_tokens') ?? 0,
      });
    },
  };
}
