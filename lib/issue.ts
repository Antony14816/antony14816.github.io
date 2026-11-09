/**
 * Issue本文のパーサーとバリデーション。
 * 外部入力（Issue本文）は命令ではなくデータとして扱う。
 * 不正な入力はAI呼び出し前に却下する。
 */
import type { BreedingMode, BreedingRequest, ParentId } from './types.ts';

const MAX_BODY_LENGTH = 4000;
const MAX_FIELD_LENGTH = 100;

/** 許可するID形式のみ通す（正規表現と長さ上限）。 */
// ID名前空間は2種類のみ。子作品はデータモデルの id 形式 "mashup-000001" をそのまま親参照に使う。
const PROTOPEDIA_ID = /^protopedia:\d{1,9}$/;
const MASHUP_ID = /^mashup-\d{1,9}$/;

export type ParseResult =
  | { ok: true; request: BreedingRequest }
  | { ok: false; reason: string };

function isValidId(id: string): id is ParentId {
  return PROTOPEDIA_ID.test(id) || MASHUP_ID.test(id);
}

/**
 * Issue本文をパースする。許可フィールドはこの関数で明示的に定義する。
 * タイトルは表示用なので一切信用しない。
 */
export function parseBreedingIssue(body: string): ParseResult {
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, reason: `本文が長すぎます（${MAX_BODY_LENGTH}文字上限）` };
  }

  const fields = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const m = /^([a-z_]+):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, key, value] = m;
    if (fields.has(key)) continue; // 最初の出現を採用
    if (value.length > MAX_FIELD_LENGTH) {
      return { ok: false, reason: `フィールド ${key} が長すぎます` };
    }
    fields.set(key, value.trim());
  }

  const parentA = fields.get('parent_a');
  const parentB = fields.get('parent_b');
  if (!parentA || !parentB) {
    return { ok: false, reason: 'parent_a と parent_b が必要です' };
  }
  if (!isValidId(parentA) || !isValidId(parentB)) {
    return { ok: false, reason: 'ID形式が不正です（protopedia:<数字> または mashup-<数字>）' };
  }
  if (parentA === parentB) {
    return { ok: false, reason: '親Aと親Bは別のIDでなければなりません' };
  }

  const modeRaw = fields.get('mode') ?? 'fusion';
  if (modeRaw !== 'fusion') {
    return { ok: false, reason: `未対応のmodeです: ${modeRaw}` };
  }
  const mode: BreedingMode = 'fusion';

  const schemaRaw = fields.get('schema_version');
  if (schemaRaw !== undefined && schemaRaw !== '1') {
    return { ok: false, reason: `未対応のschema_versionです: ${schemaRaw}` };
  }

  return { ok: true, request: { schemaVersion: 1, parentA, parentB, mode } };
}

/** 同じ親の組を重複生成しない（順序を問わない）。 */
export function samePair(a: readonly [string, string], b: readonly [string, string]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/**
 * 親として参照できるのは「ProtoPediaの実在作品」か「すでに生まれた子作品」のみ。
 * 未来の親・存在しないIDを拒否する（循環参照防止の第一歩）。
 */
export function validateParents(
  request: BreedingRequest,
  knownProtopediaIds: ReadonlySet<string>,
  knownOffspringIds: ReadonlySet<string>,
): ParseResult {
  for (const id of [request.parentA, request.parentB]) {
    if (id.startsWith('protopedia:')) {
      if (!knownProtopediaIds.has(id)) {
        return { ok: false, reason: `存在しないProtoPedia作品です: ${id}` };
      }
    } else if (id.startsWith('mashup-')) {
      if (!knownOffspringIds.has(id)) {
        return { ok: false, reason: `まだ生まれていない子作品は親にできません: ${id}` };
      }
    } else {
      return { ok: false, reason: `未知のID名前空間です: ${id}` };
    }
  }
  return { ok: true, request };
}
