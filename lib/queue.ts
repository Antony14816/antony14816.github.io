/**
 * 配合キューの選択。（issue #16 / AGENTS.md「キュー取得・バリデーション」）
 *
 * - open Issue から申請形式に合うものを作成日時**昇順**で選ぶ。ラベルは信用しない
 *   （タイトル `[Breed]` または本文に parent_a: 行があるものだけを候補にする）。
 * - 処理済みIssue（processed-issues.json）を照合し、二重処理を防ぐ。
 * - 不正な申請はAI呼び出し**前に**却下理由を返す（呼び出し側が理由をコメントして記録する）。
 * - 「妥当な申請のうち最も古い1件」を選ぶ。不正な申請が古い順に1件ずつ
 *   却下されていくため、不正Issueの大量投稿でもAI呼び出しは増えない。
 * - このモジュールは純関数（Node依存なし）。フロントは呼ばない。
 */
import { parseBreedingIssue, samePair, validateParents } from './issue.ts';
import { isAncestorDescendantPair } from './generation.ts';
import type { BreedingRequest } from './types.ts';

/** GitHub API から拾う Issue（外部入力をそのまま保持するだけ）。 */
export interface IssueRecord {
  number: number;
  title: string;
  body: string;
  /** created_at（ISO 8601） */
  createdAt: string;
}

export type ProcessedStatus = 'resolved' | 'rejected' | 'failed';

export interface ProcessedEntry {
  issue: number;
  status: ProcessedStatus;
  /** 却下・失敗の理由（ログ・Issueコメント用。短く保つ） */
  reason?: string;
  /** 処理日時（ISO 8601） */
  at: string;
  /** 処理試行回数（failed の再試行上限に使う） */
  attempts: number;
}

/** key = Issue番号（文字列） */
export type ProcessedIssues = Record<string, ProcessedEntry>;

/**
 * failed（一時失敗）として再処理する回数の上限。
 * 超えたら同じ失敗を無限に再処理しない（AGENTS.md「不正・失敗したIssueを無限に再処理しない」）。
 */
export const MAX_FAILED_ATTEMPTS = 3;

export function isProcessedIssues(raw: unknown): raw is ProcessedIssues {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) return false;
    if (typeof value !== 'object' || value === null) return false;
    const e = value as Record<string, unknown>;
    if (e.issue !== Number(key)) return false;
    if (e.status !== 'resolved' && e.status !== 'rejected' && e.status !== 'failed') return false;
    if (typeof e.at !== 'string') return false;
    if (typeof e.attempts !== 'number' || !Number.isInteger(e.attempts) || e.attempts < 1) {
      return false;
    }
  }
  return true;
}

export function emptyProcessedIssues(): ProcessedIssues {
  return {};
}

/** 配合申請に見えるIssueか（タイトル表示用。本文パースは parseBreedingIssue が正）。 */
export function looksLikeBreedingIssue(issue: Pick<IssueRecord, 'title' | 'body'>): boolean {
  return issue.title.startsWith('[Breed]') || /^parent_a:/m.test(issue.body ?? '');
}

export type QueueSelection =
  | { action: 'none' }
  | {
      action: 'reject';
      issue: IssueRecord;
      request: BreedingRequest | null; // パース前に却下した場合は null
      reason: string;
      key: string;
    }
  | {
      action: 'process';
      issue: IssueRecord;
      request: BreedingRequest;
      key: string;
    };

export interface QueueOptions {
  processed: ProcessedIssues;
  knownProtopediaIds: ReadonlySet<string>;
  knownOffspringIds: ReadonlySet<string>;
  /** すでに生まれた子作品の親ペア（samePair で重複生成を防ぐ） */
  offspringPairs: ReadonlyArray<readonly [string, string]>;
  /** 系譜のエッジ（parent → child）。近親交配（祖先×子孫）の検出に使う。 */
  edges: ReadonlyArray<readonly [string, string]>;
}

/**
 * 処理対象のIssueを1件選ぶ。
 * - 何もなければ { action: 'none' }
 * - 不正なら最も古い候補を却下対象として返す（理由つき・AIは呼ばない）
 * - 妥当なら最も古い申請を processing 対象として返す
 */
export function selectBreedingIssue(
  issues: readonly IssueRecord[],
  opts: QueueOptions,
): QueueSelection {
  const candidates = issues
    .filter((i) => i && typeof i.number === 'number' && looksLikeBreedingIssue(i))
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number);

  for (const issue of candidates) {
    const key = String(issue.number);
    const done = opts.processed[key];
    if (done) {
      // resolved / rejected は永くスキップ。failed は上限までは再試行する。
      if (done.status !== 'failed') continue;
      if (done.attempts >= MAX_FAILED_ATTEMPTS) continue;
    }

    const parsed = parseBreedingIssue(issue.body ?? '');
    if (!parsed.ok) {
      return { action: 'reject', issue, request: null, reason: parsed.reason, key };
    }
    const parents = validateParents(
      parsed.request,
      opts.knownProtopediaIds,
      opts.knownOffspringIds,
    );
    if (!parents.ok) {
      return { action: 'reject', issue, request: parsed.request, reason: parents.reason, key };
    }
    const pair: [string, string] = [parsed.request.parentA, parsed.request.parentB];
    if (opts.offspringPairs.some((p) => samePair(p, pair))) {
      return {
        action: 'reject',
        issue,
        request: parsed.request,
        reason: '同じ親の組み合わせはすでに生成されています',
        key,
      };
    }
    if (isAncestorDescendantPair(pair[0], pair[1], opts.edges)) {
      return {
        action: 'reject',
        issue,
        request: parsed.request,
        reason: '親の一方がもう一方の先祖です（系譜上、この組み合わせは避けています）',
        key,
      };
    }
    return { action: 'process', issue, request: parsed.request, key };
  }

  return { action: 'none' };
}
