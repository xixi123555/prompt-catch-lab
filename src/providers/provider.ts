/**
 * Provider 抽象：两种 API 形态对外只暴露同一个 send()，
 * 上层场景运行器与报告层不需要知道厂商字段差异。
 */
import type { PromptFixture } from '../fixture.js';
import type { ProviderId, Usage } from '../types.js';

export interface Provider {
  readonly id: ProviderId;
  /** 实际使用的端点，报告里会打出来便于排错 */
  readonly baseUrl: string;
  readonly model: string;
  /** 发一次完整请求并返回归一化后的用量 */
  send(fixture: PromptFixture, maxTokens: number): Promise<Usage>;
}
