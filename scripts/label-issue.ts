/**
 * Issue種別の自動ラベル付け（issue #13）。
 *
 * - タイトルが `[Breed]` で **かつ** 本文に `parent_a:` / `parent_b:` 行がある
 *   → `breeding-request`（配合申請）。それ以外 → `enhancement`（機能追加など）。
 * - ラベルはワークフロー側で管理する（AGENTS.md: 利用者が付けた前提にしない）。
 * - **ラベルは表示・整理用**。交配ワーカーのキュー判定は lib/issue.ts の本文パースが担い、
 *   ラベルは信用しない。
 * - Issue本文はシェルコマンド・GitHub Actions式へ埋め込まない。受け取るのは Issue 番号だけで、
 *   本文は GITHUB_TOKEN 付き fetch で API から読む（トークンは env のまま。表示しない）。
 *
 * 使い方（GitHub Actions 内）:
 *   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo ISSUE_NUMBER=12 \
 *     node --experimental-strip-types scripts/label-issue.ts
 */
import { fileURLToPath } from 'node:url';

const BREED_LABEL = 'breeding-request';
const BREED_LABEL_COLOR = '1d76db'; // 青（enhancement 既定色と区別）
const BREED_LABEL_DESC = '配合申請（[Breed] タイトル + 本文 parent_a/parent_b 行）';
const DEFAULT_LABEL = 'enhancement';

/** 意図判定。バリデーションは lib/issue.ts が行うここでは表示用にだけ分類する。 */
export function classifyIssueKind(title: string, body: string | null): 'breeding-request' | 'enhancement' {
  const isBreed = /^\[Breed\]/.test(title.trim()) && /^parent_[ab]:/m.test(body ?? '');
  return isBreed ? BREED_LABEL : DEFAULT_LABEL;
}

type ApiOptions = { method?: string; body?: unknown; allow422?: boolean };

async function api(path: string, opts: ApiOptions = {}): Promise<Response> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN が未設定です（値は表示しません）');
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'mashup-ours-label-issue',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  // 422 = ラベルが既に存在 など「あってもよい失敗」だけ許容
  if (!res.ok && !(opts.allow422 && res.status === 422)) {
    throw new Error(`GitHub API ${opts.method ?? 'GET'} ${path} → ${res.status}`); // 本文・トークンは出さない
  }
  return res;
}

async function main(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!repo || !/^\d+$/.test(process.env.ISSUE_NUMBER ?? '')) {
    throw new Error('GITHUB_REPOSITORY と ISSUE_NUMBER（数値）が必要です');
  }

  const res = await api(`/repos/${repo}/issues/${issueNumber}`);
  const issue = (await res.json()) as { title?: string; body?: string | null };
  const label = classifyIssueKind(issue.title ?? '', issue.body ?? null);

  // ラベルが無ければ作成（breeding-request は既定ラベルにない）
  await api(`/repos/${repo}/labels`, {
    method: 'POST',
    body: { name: label, color: BREED_LABEL_COLOR, description: BREED_LABEL_DESC },
    allow422: true,
  });
  await api(`/repos/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    body: { labels: [label] },
  });
  // タイトル・本文はログに出さない（Issue番号と判定結果だけ）
  console.log(`#${issueNumber} → ${label}`);
}

// 直接実行されたときだけ main（テストから import されるときは分類関数だけ使う）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
