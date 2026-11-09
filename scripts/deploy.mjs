/**
 * デプロイコマンド: npm run deploy
 *
 * 1. mainブランチかつ作業ツリーがクリーンか確認（でなければ中断）
 * 2. テスト → データ検証 → 本番ビルド
 * 3. push → GitHub Actions (deploy.yml) が GitHub Pages へデプロイ
 *
 * ローカルから直接 Pages へ書かない。デプロイの経路は常に Actions 一択にする。
 */
import { spawnSync } from 'node:child_process';

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    console.error(`\n❌ ${cmd} ${args.join(' ')} が失敗しました (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  return r;
}

// --- 1. 前提チェック ---------------------------------------------------------

const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
  .stdout.trim();
if (branch !== 'main') {
  console.error(`❌ main ブランチでのみデプロイできます（現在: ${branch}）`);
  process.exit(1);
}

const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
if (status) {
  console.error('❌ 未コミットの変更があります。先にコミットしてから deploy してください:');
  console.error(status.split('\n').map((l) => `   ${l}`).join('\n'));
  process.exit(1);
}

const ahead = spawnSync('git', ['rev-list', '--count', 'origin/main..HEAD'], { encoding: 'utf8' })
  .stdout.trim();
if (ahead === '0') {
  console.error('❌ push するコミットがありません（origin/main と同じ位置です）');
  process.exit(1);
}

// --- 2. 検証 -----------------------------------------------------------------

run('npm', ['test']);
run('npm', ['run', 'validate-data']);
run('npm', ['run', 'build']);

// --- 3. push → Actions がデプロイ --------------------------------------------

run('git', ['push', 'origin', 'main']);

const repo = process.env.GITHUB_REPOSITORY ?? 'owner/repo';
console.log(`
✅ push しました。GitHub Actions がデプロイします:
   https://github.com/${repo}/actions
（初回は Settings → Pages → Source が "GitHub Actions" に設定されていること）`);
