/**
 * npm run gitpush -- "コミットメッセージ"
 *
 * git add -A → commit → push を一発で行う。
 * - メッセージ未指定時はステータスから自動生成する。
 * - 変更がなければ commit せず終了する。
 * - push 先は現在のブランチ（初回は -u で upstream 設定）。
 * - Claude Code が関与したコミットとして Co-Authored-By を付ける。
 */
import { spawnSync } from 'node:child_process';

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', ...opts });
  return r;
}

function gitOrDie(args) {
  const r = git(args);
  if (r.status !== 0) {
    console.error(`❌ git ${args.join(' ')} が失敗しました`);
    if (r.stderr) console.error(r.stderr.trim());
    process.exit(r.status ?? 1);
  }
  return r.stdout.trim();
}

// --- add -------------------------------------------------------------------
gitOrDie(['add', '-A']);

const staged = git(['diff', '--cached', '--name-only']).stdout.trim();
if (!staged) {
  console.log('変更がないため push は行いませんでした。');
  process.exit(0);
}

// --- commit ----------------------------------------------------------------
const message = process.argv[2] ?? `update: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

gitOrDie(['commit', '-m', fullMessage]);
console.log(`✅ コミットしました: ${message}`);

// --- push ------------------------------------------------------------------
const branch = gitOrDie(['rev-parse', '--abbrev-ref', 'HEAD']);
gitOrDie(['push', '-u', 'origin', branch]);

const files = staged.split('\n').length;
console.log(`✅ push しました（${files}ファイル, ブランチ: ${branch}）`);
