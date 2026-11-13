/**
 * Provider 工厂：按配置创建对应形态的适配器。
 */
import type { Config } from '../config.js';
import type { ProviderId } from '../types.js';
import type { Provider } from './provider.js';
import { createOpenAIProvider } from './openai.js';
import { createAnthropicProvider } from './anthropic.js';

export type { Provider } from './provider.js';

export function createProviders(config: Config): Provider[] {
  const ids: ProviderId[] =
    config.provider === 'both' ? ['openai', 'anthropic'] : [config.provider];

  return ids.map((id) => {
    const baseUrl = config.baseUrls[id];
    if (id === 'openai') {
      return createOpenAIProvider({ apiKey: config.apiKey, baseUrl, model: config.model });
    }
    return createAnthropicProvider({
      apiKey: config.apiKey,
      baseUrl,
      model: config.model,
      explicitCacheControl: config.explicitCacheControl,
    });
  });
}
