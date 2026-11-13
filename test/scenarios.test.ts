/**
 * 场景变体的行为测试：核心断言是"只改了预期的那个位置"。
 * 这个性质一旦被破坏，实验结论就会被错误归因，所以必须守住。
 */
import { describe, expect, it } from 'vitest';
import { buildBaseFixture } from '../src/fixture.js';
import { SCENARIOS, selectScenarios } from '../src/scenarios.js';
import type { PromptFixture } from '../src/fixture.js';

const base: PromptFixture = buildBaseFixture('test-salt');

function getScenario(id: string) {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`缺少场景 ${id}`);
  return scenario;
}

describe('场景矩阵', () => {
  it('场景 id 唯一', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个场景都有唯一的中文名，控制台不再直接暴露英文 id', () => {
    const labels = SCENARIOS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const scenario of SCENARIOS) {
      expect(scenario.label).not.toBe(scenario.id);
      // 至少含一个中文字符，保证给文章配图时不会露出英文标识
      expect(scenario.label).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('每个场景都返回新对象，不污染入参', () => {
    const before = structuredClone(base);
    for (const scenario of SCENARIOS) {
      scenario.mutate(base);
    }
    expect(base).toEqual(before);
  });

  it('baseline 与基线完全一致', () => {
    const variant = getScenario('baseline').mutate(base);
    expect(variant).toEqual(base);
  });

  it('tool-description 只改 tools[1] 的描述', () => {
    const variant = getScenario('tool-description').mutate(base);
    expect(variant.tools).toHaveLength(base.tools.length);
    expect(variant.tools[0]).toEqual(base.tools[0]);
    expect(variant.tools[1]?.name).toBe(base.tools[1]?.name);
    expect(variant.tools[1]?.description).not.toBe(base.tools[1]?.description);
    expect(variant.tools[2]).toEqual(base.tools[2]);
    expect(variant.system).toBe(base.system);
    expect(variant.messages).toEqual(base.messages);
  });

  it('tool-add 只在末尾追加一个工具', () => {
    const variant = getScenario('tool-add').mutate(base);
    expect(variant.tools).toHaveLength(base.tools.length + 1);
    expect(variant.tools.slice(0, base.tools.length)).toEqual(base.tools);
    expect(variant.system).toBe(base.system);
    expect(variant.messages).toEqual(base.messages);
  });

  it('tool-reorder 只交换前两个工具', () => {
    const variant = getScenario('tool-reorder').mutate(base);
    expect(variant.tools[0]).toEqual(base.tools[1]);
    expect(variant.tools[1]).toEqual(base.tools[0]);
    expect(variant.tools[2]).toEqual(base.tools[2]);
  });

  it('system-head 的改动发生在 system 靠前位置', () => {
    const variant = getScenario('system-head').mutate(base);
    expect(variant.system).not.toBe(base.system);
    // 逐字符找第一个差异点，必须落在 system 的前 30% 以内
    const diffAt = [...variant.system].findIndex((char, index) => char !== base.system[index]);
    expect(diffAt).toBeGreaterThan(0);
    expect(diffAt).toBeLessThan(base.system.length * 0.3);
    expect(variant.messages).toEqual(base.messages);
    expect(variant.tools).toEqual(base.tools);
  });

  it('system-append 保留完整原 system 作为前缀', () => {
    const variant = getScenario('system-append').mutate(base);
    expect(variant.system.startsWith(base.system)).toBe(true);
    expect(variant.system.length).toBeGreaterThan(base.system.length);
  });

  it('message-first 只改第一条消息', () => {
    const variant = getScenario('message-first').mutate(base);
    expect(variant.messages[0]?.content).not.toBe(base.messages[0]?.content);
    expect(variant.messages.slice(1)).toEqual(base.messages.slice(1));
    expect(variant.system).toBe(base.system);
    expect(variant.tools).toEqual(base.tools);
  });

  it('message-last 只改最后一条消息', () => {
    const variant = getScenario('message-last').mutate(base);
    const lastIndex = base.messages.length - 1;
    expect(variant.messages[lastIndex]?.content).not.toBe(base.messages[lastIndex]?.content);
    expect(variant.messages.slice(0, lastIndex)).toEqual(base.messages.slice(0, lastIndex));
  });

  it('message-append 的模式是"原有消息完整保留 + 末尾追加"', () => {
    const variant = getScenario('message-append').mutate(base);
    expect(variant.messages).toHaveLength(base.messages.length + 1);
    expect(variant.messages.slice(0, base.messages.length)).toEqual(base.messages);
  });

  it('selectScenarios 支持按 id 过滤且拒绝未知 id', () => {
    expect(selectScenarios([])).toHaveLength(SCENARIOS.length);
    expect(selectScenarios(['baseline']).map((s) => s.id)).toEqual(['baseline']);
    expect(() => selectScenarios(['not-exist'])).toThrow(/未知场景/);
  });
});

describe('基线载荷', () => {
  it('salt 不同则 system 前缀不同（隔离缓存谱系）', () => {
    expect(buildBaseFixture('a').system).not.toBe(buildBaseFixture('b').system);
  });

  it('system 只保留 5 条规则', () => {
    const ruleLines = base.system.split('\n').filter((line) => line.startsWith('规则 '));
    expect(ruleLines).toHaveLength(5);
  });

  it('整体载荷仍足够长，能跨过厂商的最小可缓存长度', () => {
    // system 只留 5 条，长度靠 tools 与对话历史撑；太短会测出"永远不命中"的假结论
    const payloadSize =
      base.system.length + JSON.stringify(base.tools).length + JSON.stringify(base.messages).length;
    expect(payloadSize).toBeGreaterThan(2500);
  });

  it('对话以 user 结尾且角色交替', () => {
    expect(base.messages.at(-1)?.role).toBe('user');
    base.messages.forEach((message, index) => {
      expect(message.role).toBe(index % 2 === 0 ? 'user' : 'assistant');
    });
  });

  it('工具定义结构完整', () => {
    expect(base.tools.length).toBeGreaterThanOrEqual(3);
    for (const tool of base.tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(50);
      expect(tool.parameters).toHaveProperty('type', 'object');
    }
  });
});
