/**
 * 请求载荷的构造（与厂商无关的中间表示）。
 * 关键设计：每个场景/每种 API 形态都会拿到一段唯一的 salt，放在 system 最前面。
 * 原因——前缀缓存是按内容寻址的，若两个场景共用同一段前缀，
 * 它们的命中数会互相污染（实测同一前缀在 OpenAI 形态写入后，Anthropic 形态能直接读到）。
 */

/** 与厂商无关的工具定义 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptFixture {
  system: string;
  tools: ToolSpec[];
  messages: ChatMessage[];
}

/**
 * 稳定正文：5 条规则，长度可控、一眼能读完。
 * 前缀的总长度靠 tools 段与对话历史撑，避免"system 太长"盖住实验重点。
 */
const STABLE_BODY = Array.from(
  { length: 5 },
  (_, i) =>
    `规则 ${i + 1}：处理第 ${i + 1} 类请求时，先校验输入结构是否完整，再决定处理路径；` +
    `禁止跳过校验步骤，也禁止把工具返回的原始错误直接透出给用户。` +
    `若第 ${i + 1} 类请求涉及写操作，必须在执行前复述一次将要变更的对象标识。`,
).join('\n');

/** 三个工具，描述都写得够长，保证单靠工具段就足以形成可缓存前缀 */
export function buildTools(): ToolSpec[] {
  return [
    {
      name: 'read_repository_file',
      description:
        '读取仓库中指定路径的文件内容。适用于用户已经给出明确路径的场景；' +
        '若路径不存在会返回错误码 E_PATH_NOT_FOUND，此时应提示用户确认路径而不要重复尝试。' +
        '对超过 2000 行的文件请配合行号区间参数分段读取，不要一次性拉全量内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '仓库相对路径' },
          startLine: { type: 'number', description: '起始行，1 开始' },
          endLine: { type: 'number', description: '结束行，闭区间' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_symbol',
      description:
        '在仓库内按符号名做模糊检索，返回定义位置与引用位置列表。' +
        '适合用来定位函数、类、常量的定义处；对跨文件的调用链请先检索定义再检索引用，不要反向。' +
        '结果按相关度排序，默认最多返回 20 条，可用 limit 调整但不要超过 100。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '符号名或片段' },
          limit: { type: 'number', description: '返回条数上限，默认 20' },
        },
        required: ['query'],
      },
    },
    {
      name: 'run_lint_check',
      description:
        '对指定目录执行静态检查并返回结构化问题清单。' +
        '只做检查不做修复，修复必须单独发起；返回项包含文件、行号、规则名与严重级别。' +
        '若同一规则在一次检查中命中超过 50 处，结果会被截断并在 truncated 字段标注。',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: '要检查的目录，默认仓库根' },
          rules: { type: 'array', items: { type: 'string' }, description: '只检查指定规则' },
        },
        required: [],
      },
    },
  ];
}

/** 多轮对话历史：内容足够长，让 message 段也能贡献可观的缓存前缀 */
export function buildMessages(): ChatMessage[] {
  return [
    {
      role: 'user',
      content:
        '我在排查一个缓存命中率异常的问题。系统里有一个前缀缓存层，理论上相同前缀应该复用，' +
        '但线上观测到的命中比例远低于预期。先不要给结论，帮我把可能的排查维度列出来，' +
        '并按"最可能出问题"的顺序排序，每条给出一个可以在 10 分钟内验证的办法。',
    },
    {
      role: 'assistant',
      content:
        '先给排查维度，按优先级从高到低：\n' +
        '1. 前缀真的完全一致吗：把两次请求的原始载荷序列化后逐字节比较，常见差异是时间戳、随机 id、map 遍历顺序。\n' +
        '2. 缓存粒度是否落在可缓存块边界上：多数实现按固定 token 块对齐，末尾不足一块的部分永远不命中。\n' +
        '3. 是否有隐性前缀（tools、system）被重建：即便文本相同，键的顺序变了也可能换成另一把缓存键。\n' +
        '4. TTL 与落盘延迟：首次请求写入是异步的，间隔太短会连续 miss。\n' +
        '5. 多副本各自持有本地缓存：LB 没有粘性时命中率天然被摊薄。',
    },
    {
      role: 'user',
      content:
        '第 1 条和第 3 条我有疑问。第 1 条里，如果只是 JSON 字段顺序不同，模型侧不是按 token 序列算的吗？' +
        '还有第 3 条，tools 段的顺序我能理解，但 system 段我是整段字符串，应该不会变？' +
        '请分别解释这两点在真实实现里是怎么影响缓存键的，并说明有没有可能只影响"部分前缀"而不是全部失效。',
    },
    {
      role: 'assistant',
      content:
        '两点分开说。\n' +
        '关于第 1 条：模型侧确实是按 token 序列，但"序列化顺序"决定了 token 序列本身，所以字段顺序变了 token 序列就变了。' +
        '影响范围取决于差异出现在哪：出现在最前面的差异会让后面全部失效，出现在末尾则前面的长前缀仍然命中。\n' +
        '关于第 3 条：system 是整段字符串没错，但拼接顺序通常是 tools → system → messages，' +
        '所以只改 system 的尾部，tools 段那部分前缀还是能命中；改 system 的开头才会把整段都打断。',
    },
    {
      role: 'user',
      content:
        '那帮我设计一个最小验证实验，要求能在半小时内跑完，并且能明确区分"整体失效"和"部分失效"。',
    },
    {
      role: 'assistant',
      content:
        '最小实验设计：固定一段足够长的稳定前缀，然后只在一个位置引入差异，逐次观察命中 token 的绝对值。' +
        '判定标准用绝对数而不是比例——命中数接近满额说明差异点在缓存前缀之外，命中数掉到 0 说明差异点在最前端，' +
        '命中数落在中间说明断点位置可定位。每两个请求之间留出缓存落盘时间，且每组用独立的前缀盐隔离，避免组间污染。',
    },
    {
      role: 'user',
      content: '按你给的实验设计，第一步我应该先看哪个指标？只回答一个指标名并说明理由，不要展开。',
    },
  ];
}

/**
 * 构造基线条载荷。
 * @param salt 该场景的唯一标识，写进 system 第一行，用来隔离各场景的缓存谱系
 */
export function buildBaseFixture(salt: string): PromptFixture {
  return {
    system:
      `# 缓存实验基线｜场景 salt：${salt}\n` +
      '# 角色：代码审查助手，负责在仓库内定位问题、给出可执行的修改建议。\n' +
      '# 输出约定：先给结论，再给依据，最后给验证方式；不要复述用户已经说过的内容。\n\n' +
      `${STABLE_BODY}\n\n` +
      '# 结束标记：以上规则在本次会话内始终有效。',
    tools: buildTools(),
    messages: buildMessages(),
  };
}
