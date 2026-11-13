# prompt-cache-lab

验证「提示词结构怎么改，会打掉多少前缀缓存」的小实验台。

同时跑两种 API 形态——OpenAI 的 `/chat/completions` 与 Anthropic 的 `/v1/messages`——在控制台直接打出**命中缓存的 token**、**总消耗 token**、命中率与判定结论。默认端点都是 DeepSeek（同一把 key、同一个底层缓存），方便直接对比两套协议口径。

面向技术博客的成稿：[article.md](article.md)（含真实请求载荷 JSON、每个场景的变更点、结论与工程规则）。

## 快速开始

```bash
pnpm install
cp .env.example .env.local     # 填 DEEPSEEK_API_KEY 或 DEEPSEEK_FLASH_KEY（这一步可以跳过）
pnpm measure                   # 跑完整场景矩阵
```

`.env.local` 是可选的：没有配置密钥时，`pnpm measure` 会在控制台要求你输入——输入打码成 `*`，不会回显、不落盘、也不进 shell history，按 Ctrl-C 可取消。非交互环境（CI、管道）下则改为从标准输入读一行，读不到就直接报错，不会把进程卡在等输入上。

只想单独看某个场景 / 某种形态：

```bash
pnpm measure --provider openai --scenario system-head --gap 2000
```

| 参数                 | 默认值           | 说明                                                          |
| -------------------- | ---------------- | ------------------------------------------------------------- |
| `--provider`         | `both`           | `openai` / `anthropic` / `both`                               |
| `--scenario`         | 全部             | 逗号分隔的场景 id，如 `baseline,system-head`                  |
| `--gap`              | `2000`           | 两次请求间隔毫秒。厂商的缓存落盘是异步的，间隔太短会连续 miss |
| `--model`            | `deepseek-flash` | 也可用 `MODEL` 环境变量                                       |
| `--max-tokens`       | `8`              | 输出上限。实验只看输入侧缓存，输出越小越省钱                  |
| `--no-cache-control` | 关               | Anthropic 形态不打 `cache_control` 断点                       |

环境变量：`DEEPSEEK_API_KEY`（优先）/ `DEEPSEEK_FLASH_KEY`、`DEEPSEEK_OPENAI_BASE_URL`、`DEEPSEEK_ANTHROPIC_BASE_URL`、`MODEL`。密钥来源只有两个：环境变量（含 `.env.local` 注入）或控制台手动输入，二者都不会被写进代码；`.env.local` 已被 `.gitignore` 忽略。

## 实验设计

每个场景固定发三次请求，前缀约 1,690 token（5 条规则的 system + 3 个工具 + 7 轮对话）：

1. `warm` —— 冷启动，把前缀写进缓存
2. `control` —— 与 warm 完全相同，作为"本该命中"的基准
3. `variant` —— 只在一个位置做改动，拿它的命中量和 control 比

三次请求共用一个 `salt`（写进 system 第一行），每次运行 salt 都不同：这样每组都是真正的冷启动，也不会被历史缓存或另一组实验污染。改动点与基线逐字符相同，唯一的差异就是要观测的那一处。

## 实测结果（2026-11-13，`deepseek-flash`，9 个场景 × 2 种形态）

两种形态的 27 次请求、45,772 输入 token、21,504 命中 token **完全一致**——说明同一段前缀在两套协议下命中同一份缓存。完整日志见 [results/latest.log](results/latest.log)。

对照命中 = 1,536，变体命中如下：

| 场景（控制台中文名） | 改动点            | 命令行 id          | 变体命中 | 相对对照 | 结论         |
| -------------------- | ----------------- | ------------------ | -------: | -------: | ------------ |
| 基线重复             | 无改动            | `baseline`         |    1,536 |     100% | 前缀完整保留 |
| system 首部变更      | system 正文第一条 | `system-head`      |    **0** |       0% | **整段失效** |
| system 尾部追加      | system 末尾新增   | `system-append`    |      256 |      17% | 部分失效     |
| 工具描述变更         | 第 2 个工具的描述 | `tool-description` |      640 |      42% | 部分失效     |
| 工具顺序变更         | 前两个工具互换    | `tool-reorder`     |      384 |      25% | 部分失效     |
| 工具追加             | 工具列表末尾新增  | `tool-add`         |      896 |      58% | 部分失效     |
| 首条消息变更         | 第 1 条消息正文   | `message-first`    |      896 |      58% | 部分失效     |
| 末条消息变更         | 最后一条消息正文  | `message-last`     |    1,536 |     100% | 完整保留     |
| 消息追加             | 对话末尾新增      | `message-append`   |    1,536 |     100% | 完整保留     |

由此可以读出三件事：

1. **序列化顺序是 system → tools → messages。** 改 system 正文开头命中归零，说明 system 在最前面；`system-append` 的命中停在 256（≈ system 段结束），`tool-add` / `message-first` 的命中停在 896（≈ tools 段结束），所以 messages 在最后。
2. **只有"落在缓存前缀内"的改动才会掉命中，改在尾部不影响。** 改最后一条消息、在末尾追加消息，命中一分不掉；改动越靠前，失效越多。
3. **命中数始终是 64 的整数倍**（1,536 = 24 × 64）。输入 1,689 token 但最多只能命中 1,536——尾部约 153 token 跨不过 64 token 的块边界，永远不会命中，所以**同一段前缀重复请求的命中率上限是 90.9% 而不是 100%**。

`tool-reorder` 的 384 比 system 段结束点高 128 token，说明工具重排并不是"改动点之后全灭"，DeepSeek 的块级匹配仍复用了少量后续块。system 更长的另一组配置里同样出现过这一现象（+256），所以不是单次噪声，但机制待查。

## 目录结构

```
src/
  index.ts          入口：跑矩阵、打报告
  config.ts         环境变量 + 命令行参数 + 缺密钥时的交互索取
  prompt.ts         控制台密钥输入（原始模式、打码、非 TTY 降级）
  fixture.ts        请求载荷构造（system / tools / messages + salt）
  scenarios.ts      场景矩阵，每个场景只改一处，带中文名
  labels.ts         控制台展示文案（形态名、请求角色名）
  runner.ts         预热 → 对照 → 变体 三次采样
  providers/
    openai.ts       /chat/completions 适配，读 prompt_cache_hit_tokens
    anthropic.ts    /v1/messages 适配，读 cache_read_input_tokens
  usage.ts          usage 归一化（两家字段口径不同）
  report.ts         明细表 + 影响判定 + 合计
  table.ts          等宽表格（中文按两列宽）
test/               纯函数与场景变体的单测
results/latest.log  最近一次运行的原始输出
```

## 实现说明与踩过的坑

- **两家 usage 口径不同，必须归一化。** OpenAI 的 `prompt_tokens` 已含命中部分，另有 `prompt_cache_hit_tokens`；Anthropic 的 `input_tokens` **只算未命中**，输入总量要再加 `cache_read_input_tokens` 与 `cache_creation_input_tokens`。只看 `input_tokens` 会得出"命中越多输入越少"的错误结论。
- **`cache_control` 在 DeepSeek 上是空转。** 带不带断点，命中数一模一样（都是自动缓存）；真 Anthropic 端点则必须显式打断点才建档。所以默认打上断点，换官方端点时实验仍然成立。
- **两个形态共享同一份底层缓存。** 所以 salt 里必须带上 provider 名，否则先跑的形态会给后跑的形态"预热"，后者的 warm 一上来就命中。
- **缓存落盘是异步的。** warm 之后要留间隔（默认 2s）再发 control，否则 control 也会 miss，整个场景数据作废。报告里 control 命中为 0 时会直接判"数据不可用"。
- **脚本名不能叫 `cache`。** `pnpm cache` 撞 pnpm 内置命令，会报 `unexpected argument`，这里用的是 `measure`。
- **TypeScript 锁 6.0.3。** TS 7.0 是原生移植版，`typescript-eslint` 8.x 目前直接拒绝加载（会报 `does not support TS 7.0`）。

## 验证

```bash
pnpm verify   # eslint + tsc --noEmit + vitest
```

单测覆盖两类关键性质：**每个场景只在预期位置产生差异**（否则结论会被错误归因），以及**判定阈值与中文表格列宽**的计算。真实 API 的端到端验证即 `pnpm measure`，日志见 `results/latest.log`。
