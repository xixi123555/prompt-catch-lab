/**
 * 控制台展示文案。
 * 场景/形态的英文标识只用于命令行参数与代码内部，给人看的输出统一走这里的中文名。
 */
import type { ProviderId, Sample } from './types.js';

/** 两种 API 形态的展示名 */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI 格式',
  anthropic: 'Anthropic 格式',
};

/** 单次采样在报告里的展示名 */
export const SAMPLE_LABELS: Record<Sample['label'], string> = {
  warm: '预热',
  control: '对照',
  variant: '变体',
};

export function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id];
}
