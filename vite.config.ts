import { defineConfig } from 'vitest/config';

// GitHub Pages のプロジェクトサイトとして公開するため base をリポジトリ名に合わせる。
// repo 名はハードコードせず、優先順位で決める:
//   1. VITE_BASE（明示的な上書き）
//   2. GITHUB_REPOSITORY（Actions が自動提供 → /<repo>/）
//   3. ローカル開発はルート配下（ '/' ）
const ghrRepo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const basePath = process.env.VITE_BASE ?? (ghrRepo ? `/${ghrRepo}/` : '/');

export default defineConfig({
  base: basePath,
  // Actions の GITHUB_REPOSITORY をクライアントコードへ注入する（リポジトリ名のハードコード禁止）。
  // テスト時のみダミー値を注入し、Issueリンク生成のUI挙動を検証できるようにする。
  define: {
    __GITHUB_REPOSITORY__: JSON.stringify(
      process.env.GITHUB_REPOSITORY ??
        (process.env.VITEST ? 'test-owner/test-repo' : ''),
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // マルチページ（トップ + /ideas）。GitHub Pagesは静的配信のため
    // ideas/index.html を出力し /<repo>/ideas/ に解決させる（issue #8）。
    rollupOptions: {
      input: {
        main: 'index.html',
        ideas: 'ideas/index.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 複数テストファイルが src/main.ts を import して実行結果を共有しないよう隔離
    isolate: true,
  },
});
