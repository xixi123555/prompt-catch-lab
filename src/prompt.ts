/**
 * 控制台交互：在没有密钥时向用户索取。
 * 直接读 stdin 原始模式而不是 readline，是为了把输入打码成 `*`——
 * 密钥不该明文回显在终端里，也不该留在 shell history 里。
 */

const CTRL_C = '\u0003';
const BACKSPACE = ['\u007f', '\b'];

/**
 * 向用户索取一个非空密钥。
 * @param question 提示语
 * @param readline 非 TTY（管道/CI）时的降级读一行函数，返回 undefined 表示读到 EOF
 * @throws 密钥为空、用户 Ctrl-C、或非 TTY 下读不到内容
 */
export async function promptSecret(
  question: string,
  readline?: () => Promise<string | undefined>,
): Promise<string> {
  const stdin = process.stdin;

  // 非交互场景（CI、管道）不能进原始模式，退化成读一行，避免把终端锁死
  if (!stdin.isTTY) {
    if (!readline) throw new Error(`需要密钥但当前不是交互终端：${question}`);
    const line = await readline();
    if (!line || line.trim() === '') {
      throw new Error('需要 API 密钥但标准输入没有内容，请用环境变量或 .env.local 提供');
    }
    return line.trim();
  }

  process.stdout.write(question);

  return new Promise<string>((resolve, reject) => {
    let value = '';
    const wasRaw = stdin.isRaw;

    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        // 回车提交；空值不允许，留着让用户重输
        if (char === '\r' || char === '\n') {
          if (value === '') {
            process.stdout.write('\n密钥不能为空，请重新输入：');
            continue;
          }
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        // Ctrl-C：恢复终端再退出，否则 shell 会卡在原始模式
        if (char === CTRL_C) {
          cleanup();
          process.stdout.write('\n已取消。\n');
          reject(new Error('用户取消了密钥输入'));
          return;
        }
        if (BACKSPACE.includes(char)) {
          if (value !== '') {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        // 忽略方向键等控制字符，避免把转义序列拼进密钥
        if (char < ' ') continue;
        value += char;
        process.stdout.write('*');
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}
