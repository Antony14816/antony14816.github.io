import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// base パスの決定（優先順位）:
//   1. VITE_BASE（明示的な絶対パス上書き。例: VITE_BASE=/<repo>/）
//   2. 既定 './'（**相対base**）— ドメイン・公開パスの変更に追従不要:
//      - カスタムドメインのルート配信（https://example.com/）
//      - <owner>.github.io/<repo>/（パス付き）
//      - フォーク先での公開
//      どれでもアセット・内部リンクがそのまま動く。
//      （2026-11-10 に絶対パス /<repo>/ のままカスタムドメイン公開して真っ黒になったため、
//      ドメイン変更の可能性を踏まえて相対baseへ変更。）
const basePath = process.env.VITE_BASE ?? './';

// 公開サイト一式は public/ をルートにする（ページ: public/index.html, public/ideas/index.html）。
// public/static はそのまま dist 直下へコピーされる「生ファイル」置き場（例: sprites/）。
// vitest 実行時のみルート直下の tests/ を走査するため、従来どおりカレントディレクトリをルートにする
// （VITEST は設定読み込み前に立つ。define のダミー注入と同じ既存パターン）。
const isVitest = !!process.env.VITEST;

const dataDirUrl = new URL('./data/', import.meta.url);

// ランタイム観測用: トップの main.ts が data/offspring.json をフェッチして
// 「ビルド後に生まれた誕生」を検知できるようにする（public/ 外のため emit が必要。
// dev サーバーでは同一パスへミドルウェアで返す。読み込み失敗時はフロントが
// ビルド時データへフォールバックする）。
const runtimeDataPlugin: Plugin = {
  name: 'emit-runtime-data',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'data/offspring.json',
      source: readFileSync(new URL('offspring.json', dataDirUrl), 'utf8'),
    });
  },
  configureServer(server) {
    server.middlewares.use('/data/offspring.json', (_req, res, next) => {
      try {
        const body = readFileSync(new URL('offspring.json', dataDirUrl), 'utf8');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(body);
      } catch {
        next();
      }
    });
  },
};

export default defineConfig({
  root: isVitest ? undefined : fileURLToPath(new URL('./public', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/static', import.meta.url)),
  base: basePath,
  plugins: [runtimeDataPlugin],
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
