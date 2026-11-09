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

export function newIssueUrl(
  cfg: RepoConfig,
  parentA: string,
  parentB: string,
  mode = 'fusion',
): string {
  const title = `[Breed] ${parentA} x ${parentB}`;
  // AGENTS.md: Issueの本文のみを正規の入力元とし、タイトルは表示用。
  const body = [
    `parent_a: ${parentA}`,
    `parent_b: ${parentB}`,
    `mode: ${mode}`,
    '',
    '<!-- mashup-ours: generated link -->',
  ].join('\n');
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${cfg.owner}/${cfg.repo}/issues/new?${params.toString()}`;
}
