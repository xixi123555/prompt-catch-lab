/**
 * 报告层与用量归一化的纯函数测试（不发网络请求）。
 */
import { describe, expect, it } from 'vitest';
import { judgeCacheImpact } from '../src/report.js';
import { displayWidth, renderTable } from '../src/table.js';
import { makeUsage, readNumber } from '../src/usage.js';

describe('makeUsage', () => {
  it('总消耗 = 输入 + 输出，命中率 = 命中 / 输入', () => {
    const usage = makeUsage({
      promptTokens: 3000,
      cacheReadTokens: 2816,
      cacheWriteTokens: 0,
      outputTokens: 12,
    });
    expect(usage.totalTokens).toBe(3012);
    expect(usage.cacheHitRate).toBeCloseTo(2816 / 3000, 6);
  });

  it('输入为 0 时命中率取 0，不产生 NaN', () => {
    const usage = makeUsage({
      promptTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
    expect(usage.cacheHitRate).toBe(0);
    expect(Number.isNaN(usage.cacheHitRate)).toBe(false);
  });
});

describe('readNumber', () => {
  it('支持嵌套路径与缺失字段', () => {
    const source = { a: { b: 7 }, c: 'x' };
    expect(readNumber(source, 'a', 'b')).toBe(7);
    expect(readNumber(source, 'a', 'missing')).toBeUndefined();
    expect(readNumber(source, 'c')).toBeUndefined();
    expect(readNumber(undefined, 'a')).toBeUndefined();
  });
});

describe('judgeCacheImpact', () => {
  it('命中量持平时判定为完整保留', () => {
    expect(judgeCacheImpact(2816, 2816).kind).toBe('intact');
  });

  it('1% 以内波动仍算完整保留', () => {
    expect(judgeCacheImpact(2800, 2790).kind).toBe('intact');
  });

  it('命中归零判定为整段失效', () => {
    expect(judgeCacheImpact(2816, 0).kind).toBe('broken');
  });

  it('命中显著下降但未归零判定为部分失效', () => {
    const verdict = judgeCacheImpact(2816, 1024);
    expect(verdict.kind).toBe('partial');
    expect(verdict.label).toContain('36%');
  });

  it('对照组本身没命中时判为数据不可用', () => {
    expect(judgeCacheImpact(0, 0).kind).toBe('invalid');
  });
});

describe('表格渲染', () => {
  it('中文按两列宽计算', () => {
    expect(displayWidth('缓存')).toBe(4);
    expect(displayWidth('cache')).toBe(5);
  });

  it('每行显示宽度一致（不会因为中文错位）', () => {
    const lines = renderTable(
      ['场景', '命中'],
      [
        ['baseline', '2816'],
        ['system-append', '1024'],
      ],
      ['left', 'right'],
    );
    const widths = lines.map((line) => displayWidth(line));
    expect(new Set(widths).size).toBe(1);
  });
});
