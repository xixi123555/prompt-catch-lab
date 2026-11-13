/**
 * 密钥解析与交互输入的纯逻辑测试（不发起网络请求）。
 */
import { describe, expect, it } from 'vitest';
import { normalizeApiKey, pickApiKeyFromEnv } from '../src/config.js';
import { promptSecret } from '../src/prompt.js';

describe('pickApiKeyFromEnv', () => {
  it('优先取 DEEPSEEK_API_KEY', () => {
    expect(
      pickApiKeyFromEnv({
        DEEPSEEK_API_KEY: 'sk-a',
        DEEPSEEK_FLASH_KEY: 'sk-b',
      } as NodeJS.ProcessEnv),
    ).toBe('sk-a');
  });

  it('没有主键时回退 DEEPSEEK_FLASH_KEY', () => {
    expect(pickApiKeyFromEnv({ DEEPSEEK_FLASH_KEY: 'sk-b' } as NodeJS.ProcessEnv)).toBe('sk-b');
  });

  it('都没有或只有空白时返回 undefined', () => {
    expect(pickApiKeyFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(pickApiKeyFromEnv({ DEEPSEEK_API_KEY: '   ' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe('normalizeApiKey', () => {
  it('去掉首尾空白', () => {
    expect(normalizeApiKey('  sk-abc  ')).toBe('sk-abc');
  });

  it('空值直接报错，避免带着空密钥请求接口', () => {
    expect(() => normalizeApiKey('')).toThrow(/不能为空/);
    expect(() => normalizeApiKey('   ')).toThrow(/不能为空/);
  });
});

describe('promptSecret（非交互终端降级路径）', () => {
  it('从标准输入读到的一行会被 trim 后返回', async () => {
    // 测试进程的 stdin 不是 TTY，正好走降级分支
    await expect(promptSecret('请输入：', async () => '  sk-typed  ')).resolves.toBe('sk-typed');
  });

  it('读到 EOF 时报错，而不是死等', async () => {
    await expect(promptSecret('请输入：', async () => undefined)).rejects.toThrow(
      /标准输入没有内容/,
    );
  });

  it('读到空行同样报错', async () => {
    await expect(promptSecret('请输入：', async () => '   ')).rejects.toThrow(/标准输入没有内容/);
  });

  it('非 TTY 且没有提供读取函数时，抛出可读错误而不是卡住', async () => {
    await expect(promptSecret('请输入：')).rejects.toThrow(/不是交互终端/);
  });
});
