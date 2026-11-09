/**
 * ProtoPedia API から少数の実在作品を取得し data/sample-prototypes.json に保存する。
 * （追加開発指示 §5 の試作用。全件収集は scripts/sync-protopedia.ts の仕様で、
 *   現在の試作段階では全件収集を開始しない。）
 *
 * 使い方:
 *   PROTOPEDIA_API_V2_TOKEN=<token> node scripts/fetch-sample-prototypes.mjs
 *   node scripts/fetch-sample-prototypes.mjs --count=12 --offset=0
 *   （ローカルの .env からも読む。トークンをログ・JSON に出力しない）
 *
 * 要件対応:
 *  1. トークンは環境変数（なければ .env をスクリプト内で読む。シェルへエクスポートしない）
 *  2. 少数だけ取得（limit=count の1ページのみ。maxPages でリクエスト数を上限つき）
 *  3. 公開状態（releaseFlg）とライセンス（licenseType）を検証、満たさない作品は除外
 *  4. 作品IDの重複を除外（fetchAllWorks の重複排除）
 *  5. 必要なフィールドだけ抽出（systemDescription 等の長文は保存しない）
 *  6. 画像URL（mainUrl は https のみ）と出典URLを検証（normalizeWork 内）
 *  7. data/sample-prototypes.json へ原子保存（0件拒否・tmp→rename）
 *  8. 認証情報・不要な個人情報は保存しない（作者は公開表示名のみ、@ID は除去済み）
 *  9. 失敗時は既存ファイルに触れない（例外は上位へ、保存は最後に1回だけ）
 * 10. レスポンス件数・形式が想定と異なる場合も安全に処理
 *     （型検証・results 欠落はエラー・空ページは正常終了・0件は保存拒否）
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildWorkset, fetchAllWorks, writeWorksetAtomic } from '../lib/protopedia.ts';

const OUT_PATH = fileURLToPath(new URL('../data/sample-prototypes.json', import.meta.url));
const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

/** トークン: 環境変数優先。無ければ .env をこのスクリプト内で読む（ログには出さない）。 */
function loadToken() {
  const fromEnv = process.env.PROTOPEDIA_API_V2_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  if (existsSync(ENV_PATH)) {
    const m = /^PROTOPEDIA_API_V2_TOKEN=(.+)$/m.exec(readFileSync(ENV_PATH, 'utf8'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

function intArg(name, fallback) {
  const raw = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const n = Number(raw.slice(name.length + 3));
  if (!Number.isInteger(n) || n < 0) {
    console.error(`❌ --${name} は0以上の整数で指定してください`);
    process.exit(2);
  }
  return n;
}

async function main() {
  const token = loadToken();
  if (!token) {
    console.error(
      '❌ PROTOPEDIA_API_V2_TOKEN が未設定です。\n' +
        '   トークン取得: https://protopedia.net/settings/application\n' +
        '   （環境変数か .env に PROTOPEDIA_API_V2_TOKEN=... を設定）',
    );
    process.exit(2);
  }

  // 試作: 少数件だけ。--count の上限も設け、意図しない全件取得を防ぐ。
  const count = Math.min(intArg('count', 12), 50);
  const offset = intArg('offset', 0);
  if (offset > 100_000) {
    console.error('❌ --offset が想定外に大きいです（0〜100000）');
    process.exit(2);
  }

  const started = Date.now();
  // ここで失敗しても例外は上に投げるだけ = 既存の sample-prototypes.json は無変更。
  const result = await fetchAllWorks({
    token,
    pageSize: count,
    maxWorks: count,
    maxPages: 3, // 取得試行の上限（不正レコードが続いても暴走しない）
    offsetStart: offset,
  });

  // 必要なフィールドだけ残す（仕様 §5 の取得対象。長文の技術構成は保存しない）。
  const works = result.works.map((w) => {
    const { systemDescription, ...rest } = w;
    return rest;
  });

  // 利用条件（ライセンス）が確認できない作品は対象外（仕様 §10）。
  const usable = works.filter((w) => typeof w.licenseType === 'string' && w.licenseType.length > 0);
  const noLicense = works.length - usable.length;

  const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `✅ 取得 ${works.length}件（${result.pages}リクエスト / 正規化落ち ${result.dropped}件 / ` +
      `重複 ${result.duplicates}件 / ${elapsedS}秒）`,
  );
  console.log(`   利用条件あり ${usable.length}件${noLicense > 0 ? ` / なしで除外 ${noLicense}件` : ''}`);
  console.log(`   画像URL付き ${usable.filter((w) => w.mainUrl).length}件`);

  // 0件は writeWorksetAtomic が拒否する（正常な空で既存データを上書きしない）。
  const workset = buildWorkset(usable, 'protopedia-api-v2');
  writeWorksetAtomic(OUT_PATH, workset);
  console.log(`💾 data/sample-prototypes.json に保存しました（取得: ${workset.syncedAt}）`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`❌ 取得に失敗しました（既存の data/sample-prototypes.json はそのままです）: ${msg}`);
  process.exit(1);
});
