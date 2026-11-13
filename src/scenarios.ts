/**
 * 场景矩阵：每个场景只在一个位置引入差异，其余部分与基线逐字符相同。
 * 这样才能把"命中掉了多少"准确归因到"差异出现在前缀的哪个位置"。
 */
import type { PromptFixture } from './fixture.js';

export interface Scenario {
  id: string;
  /** 控制台与报告里用的中文名，文章配图直接读这个 */
  label: string;
  /** 控制台展示用的中文说明 */
  description: string;
  /** 变体相对基线的唯一改动点，供报告层解释结果 */
  changePoint: string;
  /** 返回变体；不得原地修改入参 */
  mutate(base: PromptFixture): PromptFixture;
}

/** 深拷贝，保证每个场景互不影响 */
function clone(base: PromptFixture): PromptFixture {
  return structuredClone(base);
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'baseline',
    label: '基线重复',
    description: '完全重复同一请求（对照组）',
    changePoint: '无改动',
    mutate: (base) => clone(base),
  },
  {
    id: 'tool-description',
    label: '工具描述变更',
    description: '改一个工具的 description',
    changePoint: '第 2 个工具的描述',
    mutate: (base) => {
      const next = clone(base);
      const tool = next.tools[1];
      if (!tool) throw new Error('fixture 缺少 tools[1]');
      tool.description = tool.description.replace(
        '适合用来定位函数、类、常量的定义处',
        '适合用来定位函数、类、常量以及类型别名的定义处',
      );
      return next;
    },
  },
  {
    id: 'tool-add',
    label: '工具追加',
    description: '在工具列表末尾追加一个工具',
    changePoint: '工具列表末尾新增',
    mutate: (base) => {
      const next = clone(base);
      next.tools.push({
        name: 'write_patch',
        description:
          '把一段补丁写回指定文件。仅在前一步已经确认过目标文件与改法时使用；' +
          '写入前会做一次内容是否漂移的检查，漂移则整体放弃并返回冲突明细。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '目标文件路径' },
            patch: { type: 'string', description: '统一 diff 格式的补丁内容' },
          },
          required: ['path', 'patch'],
        },
      });
      return next;
    },
  },
  {
    id: 'tool-reorder',
    label: '工具顺序变更',
    description: '交换前两个工具的顺序',
    changePoint: '前两个工具互换',
    mutate: (base) => {
      const next = clone(base);
      const first = next.tools[0];
      const second = next.tools[1];
      if (!first || !second) throw new Error('fixture 至少需要两个工具');
      next.tools[0] = second;
      next.tools[1] = first;
      return next;
    },
  },
  {
    id: 'system-head',
    label: 'system 首部变更',
    description: '改 system 正文的第一条规则（靠前）',
    changePoint: 'system 正文第一条',
    mutate: (base) => {
      const next = clone(base);
      // 规则 1 里的这句话在正文中首次出现即位于前缀靠前的位置
      next.system = next.system.replace('禁止跳过校验步骤', '禁止跳过任何校验步骤');
      return next;
    },
  },
  {
    id: 'system-append',
    label: 'system 尾部追加',
    description: '在 system 末尾追加一段规则（靠后）',
    changePoint: 'system 末尾新增',
    mutate: (base) => {
      const next = clone(base);
      next.system += '\n# 补充规则：涉及缓存的结论必须先给出可复现的验证命令，再给解释。';
      return next;
    },
  },
  {
    id: 'message-first',
    label: '首条消息变更',
    description: '改第一条 user 消息（对话历史开头）',
    changePoint: '第 1 条消息正文',
    mutate: (base) => {
      const next = clone(base);
      const first = next.messages[0];
      if (!first) throw new Error('fixture 缺少 messages[0]');
      first.content = first.content.replace('缓存命中率异常的问题', '缓存命中率持续偏低的问题');
      return next;
    },
  },
  {
    id: 'message-last',
    label: '末条消息变更',
    description: '改最后一条 user 消息（对话历史末尾）',
    changePoint: '最后一条消息正文',
    mutate: (base) => {
      const next = clone(base);
      const last = next.messages[next.messages.length - 1];
      if (!last) throw new Error('fixture 没有消息');
      last.content = '按你给的实验设计，第一步我应该先看哪个指标？只回答一个指标名。';
      return next;
    },
  },
  {
    id: 'message-append',
    label: '消息追加',
    description: '在对话末尾追加一条新 user 消息（前缀不变）',
    changePoint: '对话末尾新增',
    mutate: (base) => {
      const next = clone(base);
      next.messages.push({
        role: 'user',
        content: '再补充一个问题：如果同一个前缀在两个不同的 API 形态下都会被命中，说明什么？',
      });
      return next;
    },
  },
];

/** 按 id 过滤场景；不传则返回全部 */
export function selectScenarios(ids: string[]): Scenario[] {
  if (ids.length === 0) return SCENARIOS;
  const wanted = new Set(ids);
  const picked = SCENARIOS.filter((s) => wanted.has(s.id));
  const missing = ids.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (missing.length > 0) {
    throw new Error(
      `未知场景：${missing.join(', ')}；可选值：${SCENARIOS.map((s) => s.id).join(', ')}`,
    );
  }
  return picked;
}
