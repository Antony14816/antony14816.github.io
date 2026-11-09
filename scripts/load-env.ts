/**
 * ローカル開発用の .env 読み込み（issue #16 / 追加開発指示 §9）。
 *
 * ルール:
 * - `.env` は gitignored。**シェルに source / export しない**。fs で読んで
 *   process.env へ**設定済みの値を上書きしない**（ActionsのSecretsを優先）。
 * - 値はログに出さない（読み込んだ内容を一切表示しない）。
 * - `KEY=VALUE` のみ受理。export プレフィックス・引用符・ interpolate は持たない
 *   （外部の.envを信用しない。単純パースで不正行は無視）。
 */
import { existsSync, readFileSync } from 'node:fs';

export function loadDotEnv(path: string): { loaded: boolean; lines: number } {
  if (!existsSync(path)) return { loaded: false, lines: 0 };
  const text = readFileSync(path, 'utf8');
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue; // 不正行は無視（読み込んだ内容は表示しない）
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      lines += 1;
    }
  }
  return { loaded: true, lines };
}
