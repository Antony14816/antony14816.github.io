/**
 * ProtoPedia API v2 アダプター（docs/protopediaapi.md 準拠）。
 *
 * セキュリティ方針:
 * - APIトークンはサーバー側（GitHub Actions / ローカルCLI）専用。
 *   このモジュールをブラウザから呼び出さない（フロントは data/prototypes.json を読むだけ）。
 * - APIレスポンスはすべて外部入力。パース・型検証・HTML除去・URL検証を通す。
 * - エラーメッセージにトークンやレスポンス本文を含めない。
 * - リトライは1ページにつき最大1回。無限リトライはしない。
 * - ページ数・総件数に上限を設ける（レート制限・暴走防止）。
 *
 * 未検証事項（docs/protopediaapi.md §11）:
 * - releaseFlg の値の意味、作品ページURLの実パス、レート制限の実値は実接続で確認する。
 */
import { renameSync, writeFileSync } from 'node:fs';
import type { ProtopediaWork, Workset } from './types.ts';

export const PROTOPEDIA_API_BASE = 'https://protopedia.net/v2/api';
export const PROTOPEDIA_SITE_BASE = 'https://protopedia.net';

/** 取得上限（デフォルト）。必要なら呼び出し側で変える。 */
export const DEFAULT_MAX_WORKS = 5000;
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 1;

// フィールド長の上限（実APIの上限は未確認のためこちらで強制する）
const CAP_TITLE = 200;
const CAP_SUMMARY = 600;
const CAP_LONG_TEXT = 2000; // 詳細説明・技術構成（約2,000文字の利用報告あり）
const CAP_URL = 2000;
const CAP_LICENSE = 80;
const MAX_AUTHORS = 10;
const MAX_TAGS = 20;
const CAP_NAME = 80;

const PRIVATE_FLAGS = new Set(['n', 'no', 'false', '0', 'private', 'draft']);

// ---------------------------------------------------------------------------
// テキストのサニタイズ
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

function codePointSafe(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/**
 * 文字列をプレーンテキスト化する: HTMLタグ除去 → 文字参照デコード →
 * 空白圧縮 → 長さ制限（末尾に …）。
 * 非文字列は空文字（フィールド欠損はエラーにせず空で扱う）。
 */
export function stripToText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  let s = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => codePointSafe(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePointSafe(parseInt(d, 10)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => NAMED_ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    // タグ除去で漢字・かなが空白で隔てられないようにする（日本語は単語間空白を使わない）
    .replace(
      /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]) (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      '$1',
    )
    .trim();
  const chars = [...s];
  if (chars.length > maxLen) s = `${chars.slice(0, maxLen).join('').trimEnd()}…`;
  return s;
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

function toIdNumber(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d{1,9}$/.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isInteger(n) || n <= 0 || n > 999_999_999) return null;
  return n;
}

/**
 * releaseFlg の公開判定。
 * 仕様書に値の定義がないため: 欠損は公開として扱う（要実測確認）、
 * 明示的な非公開値のみ除外する。
 */
export function isPublicRelease(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return !PRIVATE_FLAGS.has(String(v).trim().toLowerCase());
}

function isAllowedHttpUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > CAP_URL) return null;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** 出典URL: レスポンス内の protopedia.net のURLを使う。無ければ組み立てる。 */
function resolveSourceUrl(raw: Record<string, unknown>, idNum: number): string {
  for (const key of ['prototypeUrl', 'sourceUrl', 'url', 'link']) {
    const candidate = isAllowedHttpUrl(raw[key]);
    if (!candidate) continue;
    try {
      const host = new URL(candidate).hostname;
      if (host === 'protopedia.net' || host.endsWith('.protopedia.net')) return candidate;
    } catch {
      /* fall through */
    }
  }
  // 作品ページURLの実パスは未検証（docs §11）。実接続で確認する。
  return `${PROTOPEDIA_SITE_BASE}/prototype/${String(idNum)}`;
}

function toTextList(
  value: unknown,
  keys: string[],
  maxItems: number,
  maxLen: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= maxItems) break;
    let t = '';
    if (typeof item === 'string') {
      t = stripToText(item, maxLen);
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      for (const k of keys) {
        const v = o[k];
        if (typeof v === 'string' && v.length > 0) {
          t = stripToText(v, maxLen);
          break;
        }
      }
    }
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * APIレスポンスの1件を ProtopediaWork へ正規化する。
 * 検証に通らない入力（IDなし・作品名なし・非公開）は null を返し、
 * 壊れたレコードで既存データを汚さない。
 */
export function normalizeWork(raw: unknown): ProtopediaWork | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (!isPublicRelease(r.releaseFlg)) return null;
  const idNum = toIdNumber(r.id ?? r.prototypeId);
  if (idNum === null) return null;
  const title = stripToText(r.prototypeNm ?? r.title, CAP_TITLE);
  if (!title) return null;

  const summary =
    stripToText(r.summary, CAP_SUMMARY) || stripToText(r.freeComment, CAP_SUMMARY);

  const work: ProtopediaWork = {
    id: `protopedia:${idNum}`,
    title,
    sourceUrl: resolveSourceUrl(r, idNum),
    summary,
    generation: 0,
  };

  const mainUrl = isAllowedHttpUrl(r.mainUrl);
  if (mainUrl) work.mainUrl = mainUrl;

  const authors = toTextList(r.users, ['userNm', 'userName', 'nm', 'name'], MAX_AUTHORS, CAP_NAME);
  if (authors.length > 0) work.authors = authors;

  const tags = toTextList(r.tags, ['tagNm', 'tagName', 'nm', 'name'], MAX_TAGS, CAP_NAME);
  if (tags.length > 0) work.tags = tags;

  const license = stripToText(r.licenseType, CAP_LICENSE);
  if (license) work.licenseType = license;

  const system = stripToText(r.systemDescription, CAP_LONG_TEXT);
  if (system) work.systemDescription = system;

  const desc = stripToText(r.freeComment, CAP_LONG_TEXT);
  if (desc) work.description = desc;

  return work;
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

type FetchImpl = typeof fetch;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(
  url: string,
  token: string,
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    // ステータスのみ報告（本文・ヘッダはログに出さない）
    if (!res.ok) throw new Error(`ProtoPedia API: HTTP ${res.status} (${new URL(url).pathname})`);
    try {
      return await res.json();
    } catch {
      throw new Error('ProtoPedia API: JSONとして読めないレスポンス');
    }
  } finally {
    clearTimeout(timer);
  }
}

/** レスポンス本体から配列を探す（構造差異に暫定対応。実測で確定させる）。 */
function extractResults(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const key of ['results', 'items', 'data', 'list']) {
      const v = b[key];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

export interface FetchAllOptions {
  token: string;
  pageSize?: number;
  maxWorks?: number;
  /** ページ単位の再試行回数（既定1回。0で無効） */
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

export interface FetchAllResult {
  works: ProtopediaWork[];
  pages: number;
  /** 正規化で落ちた件数（非公開・不正レコード） */
  dropped: number;
  /** 上限に達して打ち切ったか */
  truncated: boolean;
}

/**
 * /prototype/list を limit/offset で順次取得し、正規化してまとめる。
 * 1ページ失敗時は最大1回だけ再試行し、それでも失敗したら例外を投げる
 * （呼び出し側は既存データを保持する）。
 */
export async function fetchAllWorks(opts: FetchAllOptions): Promise<FetchAllResult> {
  const {
    token,
    pageSize = DEFAULT_PAGE_SIZE,
    maxWorks = DEFAULT_MAX_WORKS,
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = opts;

  if (!token) throw new Error('APIトークンが設定されていません（PROTOPEDIA_API_V2_TOKEN）');

  const works: ProtopediaWork[] = [];
  let pages = 0;
  let dropped = 0;
  let offset = 0;

  while (works.length < maxWorks) {
    const limit = Math.min(pageSize, maxWorks - works.length);
    const url = `${PROTOPEDIA_API_BASE}/prototype/list?limit=${limit}&offset=${offset}`;

    let body: unknown = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        body = await requestJson(url, token, fetchImpl, timeoutMs);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < retries) await sleep(500 * (attempt + 1));
      }
    }
    if (body === null) {
      throw lastError instanceof Error ? lastError : new Error('ProtoPedia API: 取得失敗');
    }

    const rows = extractResults(body);
    if (rows === null) {
      throw new Error('ProtoPedia API: 想定外のレスポンス構造（結果配列が見つかりません）');
    }
    pages += 1;

    for (const row of rows) {
      const w = normalizeWork(row);
      if (w) works.push(w);
      else dropped += 1;
    }

    if (rows.length < limit) break; // 最終ページ
    offset += limit;
  }

  const truncated = works.length >= maxWorks;
  return { works, pages, dropped, truncated };
}

// ---------------------------------------------------------------------------
// 保存（失敗時に既存データを壊さない）
// ---------------------------------------------------------------------------

export function buildWorkset(works: ProtopediaWork[], source: Workset['source']): Workset {
  return {
    schemaVersion: 1,
    source,
    syncedAt: new Date().toISOString(),
    works,
  };
}

/**
 * data/prototypes.json へ原子的に書き込む。
 * - 0件は拒否（空データで正常データを上書きしないための保険）。
 * - 一時ファイルに書いてからリネーム（書き込み途中の断片で壊れないように）。
 * フェッチ失敗時はこの関数自体を呼ばない = 既存ファイルは無変更のまま残る。
 */
export function writeWorksetAtomic(outPath: string, workset: Workset): void {
  if (!Array.isArray(workset.works) || workset.works.length === 0) {
    throw new Error('作品が0件のため保存しません（既存データを保持します）');
  }
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(workset, null, 2)}\n`, 'utf8');
  renameSync(tmp, outPath);
}
