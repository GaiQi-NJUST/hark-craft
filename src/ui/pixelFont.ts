/** 5x7 像素字体（开场方块文字与标题 Logo 共用） */
export const GLYPHS: Record<string, string[]> = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

/** 返回文字的像素点（x 向右，y 向下），以及总宽度 */
export function layoutText(text: string, spacing = 1) {
  const pts: { x: number; y: number; letter: number }[] = [];
  let cursor = 0;
  [...text].forEach((ch, li) => {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let y = 0; y < g.length; y++)
      for (let x = 0; x < g[y].length; x++) if (g[y][x] === '1') pts.push({ x: cursor + x, y, letter: li });
    cursor += g[0].length + spacing;
  });
  return { pts, width: cursor - spacing, height: 7 };
}
