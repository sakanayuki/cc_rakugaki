import { defineConfig } from 'vite';

// GitHub Pages はリポジトリ名のサブパス配下で配信されるため base の指定が必須。
// これを外すと本番でアセットが 404 になる。
export default defineConfig({
  base: '/cc_rakugaki/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
