import { useEffect, useRef } from 'react';
import { GLYPHS } from './pixelFont';
import { getAtlas } from '../world/TextureAtlas';
import type { TileName } from '../world/Blocks';

/** 方块风格 Logo：每个像素是一块带贴图、倒角与挤出阴影的小方块 */
export function BlockLogo({ text = 'HARK CRAFT', pixel = 11 }: { text?: string; pixel?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const atlas = getAtlas();
    const words = text.split(' ');
    const P = pixel;
    const depth = Math.round(P * 0.55);
    // 计算宽度
    const glyphW = (ch: string) => (GLYPHS[ch]?.[0].length ?? 3);
    let cols = 0;
    words.forEach((w, wi) => {
      [...w].forEach((ch, i) => (cols += glyphW(ch) + (i < w.length - 1 ? 1 : 0)));
      if (wi < words.length - 1) cols += 3;
    });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cols * P + depth + 8;
    const H = 7 * P + depth + 8;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.aspectRatio = `${W} / ${H}`;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    const tiles: Record<string, HTMLCanvasElement> = {};
    const tile = (n: TileName) => (tiles[n] ??= atlas.tileCanvas(n));

    const cells: { x: number; y: number; word: number }[] = [];
    let cursor = 0;
    words.forEach((w, wi) => {
      [...w].forEach((ch, i) => {
        const g = GLYPHS[ch] ?? GLYPHS[' '];
        for (let y = 0; y < 7; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === '1') cells.push({ x: cursor + x, y, word: wi });
        cursor += g[0].length + (i < w.length - 1 ? 1 : 0);
      });
      cursor += 3;
    });

    const ox = 4, oy = 4;
    // 1) 挤出（立体侧面）
    for (let d = depth; d > 0; d--) {
      for (const c of cells) {
        const shade = c.word === 0 ? `rgb(${90 - d * 2},${55 - d},${10})` : `rgb(${40 - d},${44 - d},${48 - d})`;
        ctx.fillStyle = shade;
        ctx.fillRect(ox + c.x * P + d, oy + c.y * P + d, P, P);
      }
    }
    // 2) 正面：贴图 + 倒角
    for (const c of cells) {
      const x = ox + c.x * P, y = oy + c.y * P;
      const t: TileName = c.word === 0 ? 'gold' : c.y < 2 ? 'grass_top' : 'stone';
      ctx.drawImage(tile(t), 0, 0, 16, 16, x, y, P, P);
      if (c.word === 1 && c.y >= 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y, P, P);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, y, P, Math.max(1, P * 0.12));
      ctx.fillRect(x, y, Math.max(1, P * 0.12), P);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x, y + P - Math.max(1, P * 0.12), P, Math.max(1, P * 0.12));
      ctx.fillRect(x + P - Math.max(1, P * 0.12), y, Math.max(1, P * 0.12), P);
    }
  }, [text, pixel]);

  return <canvas ref={ref} className="block-logo" aria-label={text} />;
}
