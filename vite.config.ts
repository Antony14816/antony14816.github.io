import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// GitHub Pages のプロジェクトサイトとして公開するため base をリポジトリ名に合わせる。
// repo 名はハードコードせず、優先順位で決める:
//   1. VITE_BASE（明示的な上書き）
//   2. GITHUB_REPOSITORY（Actions が自動提供 → /<repo>/）
//   3. ローカル開発は '/' ）
const ghrRepo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const basePath = process.env.VITE_BASE ?? (ghrRepo ? `/${ghrRepo}/` : '/');

// 公開サイト一式は public/ をルートにする（ページ: public/index.html, public/ideas/index.html）。
// public/static はそのまま dist 直下へコピーされる「生ファイル」置き場（例: sprites/）。
// vitest 実行時のみルート直下の tests/ を走査するため、従来どおりカレントディレクトリをルートにする
// （VITEST は設定読み込み前に立つ。define のダミー注入と同じ既存パターン）。
const isVitest = !!process.env.VITEST;

export default defineConfig({
  root: isVitest ? undefined : fileURLToPath(new URL('./public', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/static', import.meta.url)),
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
    // root が public/ のため outDir・input は絶対パスで指定（相対だと public/dist になる）
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    // outDir が project root 外のため Vite は自動で中身を消さないので明示的に空にする
    // （消さないと旧ハッシュのバンドルが dist に残り続ける）
    emptyOutDir: true,
    sourcemap: true,
    // マルチページ（トップ + /ideas）。GitHub Pagesは静的配信のため
    // public/ideas/index.html を出力し /<repo>/ideas/ に解決させる（issue #8）。
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./public/index.html', import.meta.url)),
        ideas: fileURLToPath(new URL('./public/ideas/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 複数テストファイルがUIモジュールを import して実行結果を共有しないよう隔離
    isolate: true,
  },
});
