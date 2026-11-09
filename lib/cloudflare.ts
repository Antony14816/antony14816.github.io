/**
 * Cloudflare Workers AI REST アダプター。（issue #16 / 追加開発指示 §2・§9）
 *
 * 公式ドキュメントで確認済みの仕様のみを使う:
 * - エンドポイント: POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}
 * - 認証: Authorization: Bearer {API_TOKEN}
 * - レスポンス envelope: { result, success, errors, messages }
 * - flux-1-schnell の画像は result.image に base64（data:image/jpeg;base64,... 形式の例が公式にあり）
 * - **gpt-oss-20b の同期応答は実接続で確認済み（2026-11 / npm run breed:check-ai）**:
 *   OpenAI互換 `object: "chat.completion"`、本文は `choices[0].message.content`、
 *   `usage` に prompt/completion/total_tokens と `neurons`（Workers AI の消費単位・**試算**）。
 *   **推論モデル**のため `max_tokens` は思考込みの予算（不足で content=null / finish_reason=length、
 *   思考は `message.reasoning_content`）。応答候補は他にも吸収しておく
 *   （result.response / choices[0].text / result が文字列）。
 * - **flux-1-schnell の応答形式（result.image の base64）は未検証**（check-ai はテキストのみ確認）。
 *
 * セキュリティ方針（追加開発指示 §9 / AGENTS.md）:
 * - APIトークンはサーバー側（GitHub Actions / ローカルCLI）専用。フロントからは呼ばない。
 * - トークン・認証ヘッダ・レスポンス本文をエラーメッセージ・ログ・Issueコメントに出さない。
 * - タイムアウト必須・リトライ回数に上限（無限リトライしない）。
 * - エラーは種別（認証/レート/サーバー/要求/通信/応答）に分類して呼び出し側の運用判断に返す。
 */

export type CfErrorKind =
  | 'auth' // 401/403 — 認証・権限。再試行しても直らない → 設定確認へ
  | 'rate' // 429 — レート制限/無料枠
  | 'server' // 5xx — 一時障害
  | 'bad-request' // 400系（モデル名・body不正）
  | 'network' // 接続・DNS
  | 'timeout' // タイムアウト
  | 'response'; // envelope不正・JSON読めない・成果物欠落

export class CfError extends Error {
  readonly kind: CfErrorKind;
  /** HTTPステータス（通信以前の失敗では undefined）。 */
  readonly status?: number;
  /** この種別が一時的で再試行可能な失敗か（呼び出し側のリトライ判断用）。 */
  readonly retryable: boolean;
  /** モデルID（ログ用。トークンは含めない）。 */
  readonly model: string;

  constructor(kind: CfErrorKind, message: string, opts: { status?: number; model: string }) {
    // メッセージはこのモジュール内で組み立てるだけ（外部入力・認証情報は含めない）。
    super(`Cloudflare Workers AI [${kind}]: ${message}`);
    this.name = 'CfError';
    this.kind = kind;
    this.status = opts.status;
    this.model = opts.model;
    this.retryable = kind === 'rate' || kind === 'server' || kind === 'network' || kind === 'timeout';
  }
}

export interface CfRunOptions {
  accountId: string;
  apiToken: string;
  /** 例: "@cf/openai/gpt-oss-20b", "@cf/black-forest-labs/flux-1-schnell" */
  model: string;
  /** リクエストボディ（モデルごとの形。そのままJSON送信する） */
  body: unknown;
  /** 既定 60000ms。必ず上限を設ける。 */
  timeoutMs?: number;
  /** 一時障害の再試行回数（既定1回 = 合計2回試行）。auth/bad-request は再試行しない。 */
  retries?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 1;

function kindFromStatus(status: number): CfErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status >= 500) return 'server';
  return 'bad-request';
}

/**
 * Workers AI を1回呼ぶ（再試行つき）。成功時は envelope の result 部分を返す。
 * エラーは必ず CfError。どの例外でもメッセージにトークンは入らない
 * （ヘッダ・URLにトークンは使わず、エラーはステータスとモデル名だけ）。
 */
export async function cfAiRun(opts: CfRunOptions): Promise<unknown> {
  const {
    accountId,
    apiToken,
    model,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    fetchImpl = fetch,
  } = opts;

  if (!accountId) throw new CfError('auth', 'ACCOUNT_ID が未設定です', { model });
  if (!apiToken) throw new CfError('auth', 'API_TOKEN が未設定です', { model });

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  let lastError: CfError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 控えめな待機（1秒 × 試行回数）。無制限リトライはしない。
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        // 本文は読まない・ログにも出さない（エラーページに機微情報が含まれうるため）。
        const err = new CfError(kindFromStatus(res.status), `HTTP ${res.status}`, {
          status: res.status,
          model,
        });
        if (!err.retryable) throw err;
        lastError = err;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        throw new CfError('response', 'JSONとして読めないレスポンス', { status: res.status, model });
      }

      // envelope 検証（公式形式: {result, success, errors, messages}）
      if (typeof parsed !== 'object' || parsed === null) {
        throw new CfError('response', 'envelope がオブジェクトではありません', { model });
      }
      const env = parsed as Record<string, unknown>;
      if (env.success !== true) {
        // errors は Cloudflare のコードと短いメッセージのみ拾う（本文・リクエスト内容は含めない）。
        const codes = Array.isArray(env.errors)
          ? env.errors
              .slice(0, 5)
              .map((e) => {
                const o = e as Record<string, unknown>;
                const code = o?.code !== undefined ? String(o.code) : '?';
                const msg = typeof o?.message === 'string' ? o.message.slice(0, 120) : '';
                return msg ? `${code}:${msg}` : code;
              })
              .join(', ')
          : '詳細なし';
        const err = new CfError('response', `success=false (${codes})`, { model });
        lastError = err;
        continue; // envelope エラーは一時的なこともあり、上限つきで再試行する
      }
      if (!('result' in env)) {
        throw new CfError('response', 'result フィールドがありません', { model });
      }
      return env.result;
    } catch (e) {
      if (e instanceof CfError) {
        if (!e.retryable) throw e;
        lastError = e;
        continue;
      }
      // fetch の例外（接続失敗 / Abort = タイムアウト）
      const isAbort = e instanceof Error && e.name === 'AbortError';
      const err = new CfError(isAbort ? 'timeout' : 'network', isAbort ? 'タイムアウト' : '通信エラー', {
        model,
      });
      lastError = err;
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new CfError('response', '不明な失敗', { model });
}

/**
 * チャット応答のテキスト部分を取り出す（gpt-oss-20b / issue #16 §2）。
 *
 * **実接続で確認済み（2026-11 / check-ai）**: 同期応答は OpenAI互換の
 * `object: "chat.completion"` 形式で、本文は `choices[0].message.content`。
 * あわせて以下も観測済み: `usage: { prompt_tokens, completion_tokens, total_tokens, neurons }`、
 * **gpt-oss は推論モデル**で `max_tokens` は思考も含む予算（不足すると
 * `content: null` + `finish_reason: "length"` になり、思考は `message.reasoning_content` に入る）。
 *
 * 候補（ドキュメントに形式の記載が無いため吸収する）:
 * 1. result.response（Workers AI テキスト生成の慣例）
 * 2. result.choices[0].message.content（OpenAI互換 ← 実測でこれ）
 * 3. result.choices[0].text
 * 4. result がそのまま文字列
 * 見つからなければ空文字（呼び出し側が失敗として扱う）。
 * **`content` が null のとき reasoning_content を本文として拾わない**（思考≠本文）。
 */
export function extractChatText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (typeof result !== 'object' || result === null) return '';
  const r = result as Record<string, unknown>;
  if (typeof r.response === 'string') return r.response;
  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const first = r.choices[0] as Record<string, unknown>;
    const msg = first?.message as Record<string, unknown> | undefined;
    // content が null（= 予算不足等）なら空文字を返す。reasoning_content は本文ではない。
    if (msg && typeof msg.content === 'string') return msg.content;
    if (typeof first?.text === 'string') return first.text;
  }
  return '';
}

/**
 * 画像の base64 部分を取り出す（flux-1-schnell / issue #16 §8）。
 * 公式の例は `data:image/jpeg;base64,...` 形式。プレフィックス無しの素の base64 も許容する。
 * 見つからなければ空文字（呼び出し側はテキスト先行保存に切り替える）。
 */
export function extractImageBase64(result: unknown): string {
  if (typeof result === 'string') return result;
  if (typeof result !== 'object' || result === null) return '';
  const r = result as Record<string, unknown>;
  if (typeof r.image === 'string') return r.image;
  return '';
}

/** data URL / 素の base64 を Buffer にする（不正な入力は例外）。 */
export function decodeBase64Image(value: string): Buffer {
  const m = /^data:image\/[a-z+.-]+;base64,(.+)$/is.exec(value);
  const b64 = m ? m[1] : value;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
    throw new CfError('response', '画像が base64 形式ではありません', { model: '(image)' });
  }
  const buf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  if (buf.length === 0) {
    throw new CfError('response', '画像データが空です', { model: '(image)' });
  }
  return buf;
}
