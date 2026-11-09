/**
 * ProtoPedia作品の同期（docs/protopediaapi.md §12 の実装）。
 *
 * 使い方:
 *   PROTOPEDIA_API_V2_TOKEN=<token> npm run sync:protopedia
 *   npm run sync:protopedia -- --dry-run   # 取得・検証まで（書き込まない）
 *   npm run sync:protopedia -- --mock      # サンプルデータで確認（書き込まない）
 *
 * 挙動:
 *   - 成功時のみ data/prototypes.json を原子的に置き換える。
 *   - 失敗時は既存ファイルに一切触れて終了コード1で終える（キャッシュ保護）。
 *   - トークンは環境変数だけ。ログ・JSON・エラーメッセージに出力しない。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_WORKS,
  DEFAULT_PAGE_SIZE,
  buildWorkset,
  fetchAllWorks,
  writeWorksetAtomic,
} from '../lib/protopedia.ts';
import type { ProtopediaWork, Workset } from '../lib/types.ts';

// JSONはfsで読む（node 実行時の import attribute 指定を避けるため。
// フロントエンドのVite側JSONインポートは従来どおり）。
const sampleWorksJson = JSON.parse(
  readFileSync(new URL('../data/protopedia-sample.json', import.meta.url), 'utf8'),
) as { works: ProtopediaWork[] };

const OUT_PATH = fileURLToPath(new URL('../data/prototypes.json', import.meta.url));

const args = new Set(process.argv.slice(2));
const mock = args.has('--mock');
const dryRun = args.has('--dry-run') || mock; // mock は常に書き込み禁止

function summaryLine(label: string, works: ProtopediaWork[], extra: string): void {
  console.log(`✅ ${label}: ${works.length}件 ${extra}`);
  const authors = works.filter((w) => (w.authors?.length ?? 0) > 0).length;
  const licensed = works.filter((w) => w.licenseType).length;
  console.log(`   作者付き ${authors}件 / ライセンス表記付き ${licensed}件`);
}

async function main(): Promise<void> {
  const token = process.env.PROTOPEDIA_API_V2_TOKEN ?? '';

  if (mock) {
    const works = (sampleWorksJson.works as ProtopediaWork[]).map((w) => ({
      ...w,
      sample: true,
    }));
    summaryLine('[mock] 開発用サンプルで確認', works, '（書き込みなし）');
    return;
  }

  if (!token) {
    console.error(
      '❌ PROTOPEDIA_API_V2_TOKEN が未設定です。\n' +
        '   トークン取得: https://protopedia.net/settings/application\n' +
        '   （--dry-run もAPI取得はするためトークンが必要。' +
        'トークンなしでパイプラインを確認する場合は --mock を使ってください。）',
    );
    process.exit(2);
  }

  const started = Date.now();
  // ここで失敗したら例外を上に投げるだけ = 既存の prototypes.json は無変更。
  const result = await fetchAllWorks({
    token,
    pageSize: DEFAULT_PAGE_SIZE,
    maxWorks: DEFAULT_MAX_WORKS,
  });
  const elapsedS = ((Date.now() - started) / 1000).toFixed(1);

  summaryLine(
    'ProtoPedia API v2',
    result.works,
    `（${result.pages}ページ / 正規化落ち ${result.dropped}件 / ${elapsedS}秒${result.truncated ? ' / 上限で打ち切り' : ''}）`,
  );

  if (dryRun) {
    console.log('🏁 dry-run: 検証のみ行い、data/prototypes.json は変更していません。');
    return;
  }

  const workset: Workset = buildWorkset(result.works, 'protopedia-api-v2');
  writeWorksetAtomic(OUT_PATH, workset);
  console.log(`💾 data/prototypes.json に保存しました（同期: ${workset.syncedAt}）`);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`❌ 同期に失敗しました（既存の data/prototypes.json はそのままです）: ${msg}`);
  process.exit(1);
});
