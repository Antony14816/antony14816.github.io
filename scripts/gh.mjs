/**
 * .env の GH_TOKEN を使い gh CLI を実行するランナー（開発issue登録用）。
 *
 * - トークンはこのスクリプトが readFileSync で .env から読むだけ。
 *   表示・ログ・コミット・シェル環境への source/export はしない
 *   （scripts/fetch-sample-prototypes.mjs と同じ扱い）。
 * - gh は子プロセスの環境変数 GH_TOKEN だけを受け取る。
 * - .env に GH_TOKEN が無いときは明示的にエラー（値は絶対に表示しない）。
 *
 * 使い方:
 *   node scripts/gh.mjs auth status
 *   node scripts/gh.mjs issue list --state open
 *   node scripts/gh.mjs issue create --title "..." --body "..."
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

function loadGhToken() {
  // シェル側で設定済みならそれを優先（.env が無くても動く）
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (!existsSync(ENV_PATH)) return '';
  const m = /^GH_TOKEN=(.+)$/m.exec(readFileSync(ENV_PATH, 'utf8'));
  if (!m) return '';
  // 引用符が付いていても値として扱う（値自体は決表示しない）
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

const token = loadGhToken();
if (!token) {
  console.error(
    '❌ .env に GH_TOKEN がありません。自分のエディタで .env に `GH_TOKEN=...` を追記してください' +
      '（Fine-grained PAT / 本リポジトリのみ / Issues: Read and write。VITE_ プレフィックスは禁止）。',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('使い方: node scripts/gh.mjs <ghサブコマンド...>  例: node scripts/gh.mjs auth status');
  process.exit(2);
}

const res = spawnSync('gh', args, {
  stdio: 'inherit', // ghの出力そのまま（トークンはgh側も表示しない）
  env: { ...process.env, GH_TOKEN: token },
});
if (res.error) {
  console.error(`❌ gh を起動できません: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
