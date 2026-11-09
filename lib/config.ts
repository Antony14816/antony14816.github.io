/**
 * リポジトリ設定。リポジトリ名・owner をコードにハードコードしないこと。
 * フロントは Vite の VITE_* 環境変数 + ビルド時注入、ワーカーは Actions の env から受け取る。
 */

import { MAX_COMMENT_LENGTH } from './issue.ts';

export interface RepoConfig {
  owner: string;
  repo: string;
}

/**
 * env は渡されなければ空として扱う（未設定時は呼び出し側が警告を出す）。
 * scripts (Node) からは process.env をそのまま渡せる。
 */
export function repoConfigFromEnv(
  env: Record<string, string | undefined> = {},
): RepoConfig | null {
  const ghr = env.GITHUB_REPOSITORY?.split('/'); // Actions: "owner/repo"
  const owner = env.VITE_GITHUB_OWNER ?? env.GITHUB_REPOSITORY_OWNER ?? ghr?.[0];
  const repo = env.VITE_GITHUB_REPO ?? ghr?.[1];
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** 配合申請リンクに含める任意フィールド（追加開発指示 §8: 元作品URL・候補スロット）。 */
export interface IssueLinkOptions {
  mode?: string;
  /** 申請時の候補スロット（UTC "YYYY-MM-DDTHHMM"・15分刻み。従来HHも許容） */
  slot?: string;
  /** 親Aの元作品URL（ProtoPediaの作品ページ） */
  parentAUrl?: string;
  /** 親Bの元作品URL */
  parentBUrl?: string;
  /** 研究員へのひとこと（任意・最大MAX_COMMENT_LENGTH字 / issue #16）。1行に正規化して埋め込む。 */
  comment?: string;
}

export function newIssueUrl(
  cfg: RepoConfig,
  parentA: string,
  parentB: string,
  opts: IssueLinkOptions = {},
): string {
  const title = `[Breed] ${parentA} x ${parentB}`;
  // AGENTS.md: Issueの本文のみを正規の入力元とし、タイトルは表示用。
  const lines = [`parent_a: ${parentA}`, `parent_b: ${parentB}`];
  if (opts.parentAUrl) lines.push(`parent_a_url: ${opts.parentAUrl}`);
  if (opts.parentBUrl) lines.push(`parent_b_url: ${opts.parentBUrl}`);
  lines.push(`mode: ${opts.mode ?? 'fusion'}`);
  if (opts.slot) lines.push(`slot: ${opts.slot}`);
  // 研究員へのひとこと（issue #16 §5）。改行はすべて空白に畳み、1行形式を保つ
  // （パーサーは1行キー:値のみ受理。切り詰めは呼び出し側の maxlength と二重の保険）。
  const comment = opts.comment?.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_LENGTH);
  if (comment) lines.push(`comment: ${comment}`);
  lines.push(
    '',
    // コメント欄のヒント（issue #7）。HTMLコメントなので投稿後は非表示、編集画面でのみ見える。
    `<!-- 任意: comment: の後に1行だけで自由記述を追加できます（最大${MAX_COMMENT_LENGTH}字・配合の動機など） -->`,
    '<!-- mashup-ours: generated link -->',
  );
  const params = new URLSearchParams({ title, body: lines.join('\n') });
  return `https://github.com/${cfg.owner}/${cfg.repo}/issues/new?${params.toString()}`;
}
