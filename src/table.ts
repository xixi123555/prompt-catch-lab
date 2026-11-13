/**
 * 极简等宽表格渲染。
 * 中文字符在终端里占两个字符宽，直接 padEnd 会错位，所以按显示宽度补齐。
 */

type Align = 'left' | 'right';

/** 是否宽字符（中日韩、全角标点等） */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    codePoint >= 0x20000
  );
}

/** 字符串在终端里占的列宽 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number, align: Align): string {
  const gap = width - displayWidth(text);
  if (gap <= 0) return text;
  return align === 'left' ? text + ' '.repeat(gap) : ' '.repeat(gap) + text;
}

/**
 * 渲染表格（不含外框，只用分隔线，控制台阅读更轻）
 * @param headers 表头
 * @param rows 数据行，列数需与表头一致
 * @param aligns 每列对齐方式，缺省左对齐
 */
export function renderTable(headers: string[], rows: string[][], aligns: Align[] = []): string[] {
  const widths = headers.map((header, index) => {
    const cellWidths = rows.map((row) => displayWidth(row[index] ?? ''));
    return Math.max(displayWidth(header), ...cellWidths, 2);
  });

  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => pad(cell, widths[index] ?? 0, aligns[index] ?? 'left'))
      .join('  ')
      .trimEnd();

  const separator = widths.map((width) => '─'.repeat(width)).join('  ');
  return [line(headers), separator, ...rows.map(line)];
}
