/**
 * 毎時の交配候補の更新。（追加開発指示 §7）
 *
 * 保存済みの作品データから、スロット（UTC "YYYY-MM-DDTHH"）に決定的に6件を選ぶ。
 * - 同じスロットなら常に同じ候補（Actionsの再実行・ローカル実行でも同じ結果）
 * - data/current-candidates.json に slot / generatedAt / nextSlot / 候補を記録
 * - プール0件・不正データ時は exit 1。既存の current-candidates.json は無変更。
 *
 * 使い方:
 *   node --experimental-strip-types scripts/rotate-candidates.ts
 *   node --experimental-strip-types scripts/rotate-candidates.ts --slot=2026-11-09T14
 *   node --experimental-strip-types scripts/rotate-candidates.ts --dry-run
 *
 * ProtoPedia APIは呼ばない（トークン不要）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATES_PER_SLOT,
  buildCandidatesFile,
  nextSlotKey,
} from '../lib/candidates.ts';
import { slotKey } from '../lib/generation.ts';
import type { ProtopediaWork } from '../lib/types.ts';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../data/current-candidates.json', import.meta.url));
/** 候補元に使う保存済みデータ（優先順）。試作段階では sample-prototypes が実績を持つ。 */
const POOL_FILES = [
  fileURLToPath(new URL('../data/prototypes.json', import.meta.url)),
  fileURLToPath(new URL('../data/sample-prototypes.json', import.meta.url)),
];

/** JSONには実行環境の絶対パスを書かない（リポジトリ相対で記録する）。 */
function repoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).replaceAll('\\', '/');
}

function readPool(path: string): ProtopediaWork[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { works?: unknown };
    if (!Array.isArray(raw.works)) return [];
    return raw.works.filter(
      (w): w is ProtopediaWork =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as ProtopediaWork).id === 'string' &&
        /^protopedia:\d{1,9}$/.test((w as ProtopediaWork).id) &&
        typeof (w as ProtopediaWork).title === 'string' &&
        (w as ProtopediaWork).title.length > 0,
    );
  } catch {
    return []; // 壊れたファイルは無視して次のソースへ（表示データは検証済みのものだけ）
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const slotArg = args.find((a) => a.startsWith('--slot='));
  const slot = slotArg ? slotArg.slice('--slot='.length) : slotKey(new Date());
  // 形式検証（不正なら例外で落とす = 書き込まない）
  nextSlotKey(slot);

  // プール選択: 6件以上確保できるファイルを優先し、なければ件数の多いファイルへ。
  // （全件同期を有効にすれば prototypes.json が自動的に優先される。試作段階では sample-prototypes）
  let pool: ProtopediaWork[] = [];
  let source = '';
  for (const file of POOL_FILES) {
    const works = readPool(file);
    if (works.length >= CANDIDATES_PER_SLOT) {
      pool = works;
      source = file;
      break;
    }
    if (works.length > pool.length) {
      pool = works;
      source = file;
    }
  }
  if (pool.length === 0) {
    console.error(
      '❌ 候補元の作品データがありません（data/sample-prototypes.json を先に作成してください: npm run fetch:sample）',
    );
    process.exit(1);
  }

  // buildCandidatesFile はプール0件で例外（= ここに来るのは1件以上）。
  const file = buildCandidatesFile(pool, slot, repoRelative(source), new Date());

  console.log(
    `✅ slot=${file.slot} 候補${file.candidates.length}件（プール${pool.length}件 / source=${source}）`,
  );
  for (const c of file.candidates) {
    const by = c.authors && c.authors.length > 0 ? ` / ${c.authors[0]}` : '';
    console.log(`   - ${c.id} ${c.title}${by}`);
  }
  console.log(`   次回更新予定: ${file.nextSlot}（UTC時間帯の切り替わり）`);

  if (dryRun) {
    console.log('🏁 dry-run: data/current-candidates.json は変更していません。');
    return;
  }

  // 原子保存: 一時ファイルに書いてからリネーム（書き込み途中の断片で壊れない）。
  const tmp = `${OUT_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  renameSync(tmp, OUT_PATH);
  console.log(`💾 data/current-candidates.json を更新しました（生成: ${file.generatedAt}）`);
}

main();
