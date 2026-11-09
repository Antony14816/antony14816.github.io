/**
 * GitHub REST API アダプター（ワーカー専用 / issue #16）。
 *
 * セキュリティ方針（AGENTS.md）:
 * - トークンは環境変数だけ。エラーメッセージ・ログ・Issue本文に出さない。
 * - Issue本文・コメントは shell へ渡さない（このモジュールでJSONとして直接送る）。
 * - タイムアウト必須・リトライは控えめ（無限リトライしない）。
 * - 外部入力（Issue本文）はここではただの文字列。評価・実行はしない。
 */
import type { IssueRecord } from './queue.ts';

const API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;

export class GitHubApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    // ステータスとメッセージだけ（トークン・レスポンス本文は含めない）
    super(`GitHub API: ${message}${status !== undefined ? ` (HTTP ${status})` : ''}`);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export interface GhOptions {
  token: string;
  /** "owner/repo" */
  repo: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

interface RawIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  created_at?: unknown;
  pull_request?: unknown;
}

/** GET リクエスト（timeout・上限つきリトライ）。戻り値は JSON（外部入力）。 */
async function ghGet(path: string, opts: GhOptions): Promise<unknown> {
  const { token, repo, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!token) throw new GitHubApiError('GITHUB_TOKEN が未設定です');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GitHubApiError('repo 形式が不正です');
  }

  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  let last: GitHubApiError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = new GitHubApiError(`HTTP ${res.status} (${path.split('?')[0]})`, res.status);
        // 4xx（認証・権限・見つからない）は再試行しない
        if (res.status >= 500 || res.status === 429) {
          last = err;
          continue;
        }
        throw err;
      }
      try {
        return await res.json();
      } catch {
        throw new GitHubApiError('JSONとして読めないレスポンス', res.status);
      }
    } catch (e) {
      if (e instanceof GitHubApiError) {
        if (e.status !== undefined && e.status < 500 && e.status !== 429) throw e;
        last = e;
        continue;
      }
      const isAbort = e instanceof Error && e.name === 'AbortError';
      last = new GitHubApiError(isAbort ? 'タイムアウト' : '通信エラー');
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new GitHubApiError('不明な失敗');
}

/**
 * open Issue を取得する（PRは除外）。最大2ページ（200件）まで。
 * body は外部入力のまま文字列として保持する（評価はしない）。
 */
export async function listOpenIssues(
  opts: GhOptions & { maxPages?: number },
): Promise<IssueRecord[]> {
  const perPage = 100;
  const maxPages = opts.maxPages ?? 2;
  const out: IssueRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await ghGet(
      `/repos/${opts.repo}/issues?state=open&sort=created&direction=asc&per_page=${perPage}&page=${page}`,
      opts,
    );
    if (!Array.isArray(body)) throw new GitHubApiError('Issue一覧が配列ではありません');
    const rows = body as RawIssue[];
    for (const row of rows) {
      if (row && typeof row.pull_request === 'object') continue; // PRは除外
      if (typeof row?.number !== 'number') continue;
      out.push({
        number: row.number,
        title: typeof row.title === 'string' ? row.title : '',
        body: typeof row.body === 'string' ? row.body : '',
        createdAt: typeof row.created_at === 'string' ? row.created_at : '',
      });
    }
    if (rows.length < perPage) break; // 最終ページ
  }
  return out;
}

/** Issueへコメント（本文は文字列のままJSONで送る = shell を介さない）。 */
export async function commentIssue(
  issueNumber: number,
  bodyText: string,
  opts: GhOptions,
): Promise<void> {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new GitHubApiError('Issue番号が不正です');
  }
  await ghPost(`/repos/${opts.repo}/issues/${issueNumber}/comments`, bodyText, opts);
}

/** POST（bodyText を JSON の body フィールドに入れる。シェル介在なし）。 */
async function ghPost(path: string, bodyText: string, opts: GhOptions): Promise<unknown> {
  const { token, repo, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!token) throw new GitHubApiError('GITHUB_TOKEN が未設定です');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GitHubApiError('repo 形式が不正です');
  }
  const url = `${API_BASE}${path}`;
  let last: GitHubApiError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: bodyText }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = new GitHubApiError(`HTTP ${res.status} (comment)`, res.status);
        if (res.status >= 500 || res.status === 429) {
          last = err;
          continue;
        }
        throw err;
      }
      try {
        return await res.json();
      } catch {
        return null; // コメント応答のJSON読めなくても送信は成功している
      }
    } catch (e) {
      if (e instanceof GitHubApiError) {
        if (e.status !== undefined && e.status < 500 && e.status !== 429) throw e;
        last = e;
        continue;
      }
      const isAbort = e instanceof Error && e.name === 'AbortError';
      last = new GitHubApiError(isAbort ? 'タイムアウト' : '通信エラー');
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new GitHubApiError('不明な失敗');
}
