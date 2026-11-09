/**
 * リポジトリ設定。リポジトリ名・owner をコードにハードコードしないこと。
 * フロントは Vite の VITE_* 環境変数 + ビルド時注入、ワーカーは Actions の env から受け取る。
 */

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

/** 交配申請リンクに含める任意フィールド（追加開発指示 §8: 元作品URL・候補スロット）。 */
export interface IssueLinkOptions {
  mode?: string;
  /** 申請時の候補スロット（UTC "YYYY-MM-DDTHH"） */
  slot?: string;
  /** 親Aの元作品URL（ProtoPediaの作品ページ） */
  parentAUrl?: string;
  /** 親Bの元作品URL */
  parentBUrl?: string;
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
  lines.push('', '<!-- mashup-ours: generated link -->');
  const params = new URLSearchParams({ title, body: lines.join('\n') });
  return `https://github.com/${cfg.owner}/${cfg.repo}/issues/new?${params.toString()}`;
}
