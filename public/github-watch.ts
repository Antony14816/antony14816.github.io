/**
 * GitHub API（匿名・認証なし）からの状態取得（issue #11）。
 *
 * - api.github.com はCORS許可の匿名アクセスで 60req/h/IP。
 *   ポーリング間隔は breeding-state.ts の定数で抑える。
 * - レート制限（403/429）を検知したら即停止し、無限リトライはしない。
 * - Issueの本文は「データ」として取り出すだけで、コマンドや式へは一切埋め込まない。
 */
import type { RepoConfig } from '../lib/config.ts';
import type { SeenIssue, Pair } from './breeding-state.ts';
import { CONFIRM_DELAYS_MS, findOpenedIssue } from './breeding-state.ts';

export interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<JsonResponse>;

/** HTTPステータスを渡せるエラー（レート制限の判定用） */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

function defaultFetch(url: string, init?: { headers?: Record<string, string> }): Promise<JsonResponse> {
  return fetch(url, init) as unknown as Promise<JsonResponse>;
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  pull_request?: unknown;
}

/**
 * 直近のIssueを新しい順に最大30件取得。
 * PR（pull_request キーあり）は除外し、`state` は open/closed のみに正規化。
 */
export async function fetchSeenIssues(
  cfg: RepoConfig,
  fetchImpl: FetchLike = defaultFetch,
): Promise<SeenIssue[]> {
  const url =
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues` +
    `?state=all&sort=created&direction=desc&per_page=30`;
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new GitHubApiError(`GitHub API ${res.status}`, res.status);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new GitHubApiError('GitHub API 異常レスポンス', 0);
  const out: SeenIssue[] = [];
  for (const raw of data as RawIssue[]) {
    if (raw == null || typeof raw !== 'object' || raw.pull_request !== undefined) continue;
    if (typeof raw.number !== 'number' || typeof raw.title !== 'string') continue;
    if (typeof raw.created_at !== 'string' || !Number.isFinite(Date.parse(raw.created_at))) {
      continue;
    }
    out.push({
      number: raw.number,
      title: raw.title,
      body: typeof raw.body === 'string' ? raw.body : '',
      state: raw.state === 'closed' ? 'closed' : 'open',
      createdAt: raw.created_at,
    });
  }
  return out;
}

export type ApplyResult = 'confirmed' | 'unconfirmed';

/**
 * Issue作成画面（window.open）のあと、実際に申請が送信されたかを確認する。
 * - 終端は confirmed / unconfirmed のどちらか。opening は main.ts 側で先に表示する。
 * - CONFIRM_DELAYS_MS の上限（最大10回・約3.5分）で必ず停止。
 * - 403/429（レート制限）は即 unconfirmed で停止。連続失敗3回でも停止。
 * - 戻り値の関数でキャンセルできる（確定後の再実行・ページ離脱）。
 */
export function watchApplyConfirmation(
  cfg: RepoConfig,
  pair: Pair,
  openedAtMs: number,
  onResult: (result: ApplyResult) => void,
  fetchImpl: FetchLike = defaultFetch,
): () => void {
  let cancelled = false;
  let attemptIndex = 0;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const finish = (result: ApplyResult): void => {
    if (cancelled || settled) return;
    settled = true;
    onResult(result);
  };

  const attempt = async (): Promise<void> => {
    if (cancelled || settled) return;
    try {
      const issues = await fetchSeenIssues(cfg, fetchImpl);
      consecutiveFailures = 0;
      if (findOpenedIssue(issues, pair, openedAtMs)) {
        finish('confirmed');
        return;
      }
    } catch (e) {
      const status = e instanceof GitHubApiError ? e.status : 0;
      if (status === 403 || status === 429) {
        finish('unconfirmed'); // レート制限: すぐ再試行しても無駄
        return;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        finish('unconfirmed');
        return;
      }
    }
    if (cancelled || settled) return;
    attemptIndex += 1;
    if (attemptIndex >= CONFIRM_DELAYS_MS.length) {
      finish('unconfirmed');
      return;
    }
    timer = setTimeout(() => {
      void attempt();
    }, CONFIRM_DELAYS_MS[attemptIndex]);
  };

  timer = setTimeout(() => {
    void attempt();
  }, CONFIRM_DELAYS_MS[0]);

  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
