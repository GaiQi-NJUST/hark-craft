import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 让 dist/ 可以直接双击 index.html（file://）打开：
 * 浏览器禁止 file:// 下加载 ES Module，因此生产构建输出为单个 IIFE 经典脚本，
 * 并把 <script type="module" crossorigin> 改写为 <script defer>。
 */
function classicScriptForFileProtocol(): Plugin {
  return {
    name: 'hark-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin/g, '<script defer')
        .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"')
        .replace(/<link rel="modulepreload"[^>]*>/g, '');
    },
  };
}

// base: './' 让 dist/ 可以部署在任意静态托管路径下（含子目录）或本地文件
export default defineConfig({
  base: './',
  plugins: [react(), classicScriptForFileProtocol()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/hark-craft-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { host: true },
});
