/**
 * 日時表示の共通処理（issue #18 / JST表示統一）。
 *
 * 方針:
 * - **内部データはUTCのISO 8601のまま**（JSON・cron・間隔判定は変更しない）。
 *   JSTへの変換は**表示するときだけ**このモジュールを通す。
 * - `Intl.DateTimeFormat` に `timeZone: 'Asia/Tokyo'` を明示指定するため、
 *   ブラウザやOSのタイムゾーン設定（UTC・海外）に表示が依存しない。
 * - 24時間表記・秒なし。不正な日時は例外を投げず `日時不明` を返して画面を壊さない。
 * - 生成された文字列に「UTC」の生データは含めない。必要に応じて `JST_NOTE`（日本時間）を付ける。
 *
 * このモジュールは表示専用。**時刻の大小比較・間隔の判定には使わない**
 * （それらは UTC の絶対時刻で行う = lib/schedule.ts / lib/candidates.ts）。
 */

/** 表示タイムゾーン（日本標準時）。 */
export const TIME_ZONE = 'Asia/Tokyo';

/** 不正・欠損の日時に表示する文字列（例外を投げない）。 */
export const UNKNOWN_TIME_LABEL = '日時不明';

/** 日時表記に添える注記（必要な場所で統一して使う）。 */
export const JST_NOTE = '（日本時間）';

/** `2026/11/10 15:00` */
const dateTimeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `2026/11/10` */
const dateFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `15:00` */
const timeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 値を Date へ。不正なら null（例外は投げない）。 */
export function toDateOrNull(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  // あり得ない年（IntlがRangeErrorを出す範囲）も不正扱いにする
  if (!Number.isFinite(t) || t < -8_640_000_000_000_000 || t > 8_640_000_000_000_000) return null;
  return d;
}

function formatWith(fmt: Intl.DateTimeFormat, value: string | number | Date | null | undefined): string {
  const d = toDateOrNull(value);
  if (!d) return UNKNOWN_TIME_LABEL;
  try {
    return fmt.format(d);
  } catch {
    // タイムゾーン/年範囲など、環境によっては例外になる場合の保険
    return UNKNOWN_TIME_LABEL;
  }
}

/** ISO日時（UTC）を `2026/11/10 15:00` に。不正なら `日時不明`。 */
export function formatDateTimeJST(value: string | number | Date | null | undefined): string {
  return formatWith(dateTimeFmt, value);
}

/** ISO日時（UTC）を `2026/11/10` に。不正なら `日時不明`。 */
export function formatDateJST(value: string | number | Date | null | undefined): string {
  return formatWith(dateFmt, value);
}

/** ISO日時（UTC）を `15:00` に。不正なら `日時不明`。 */
export function formatTimeJST(value: string | number | Date | null | undefined): string {
  return formatWith(timeFmt, value);
}

/** `2026/11/10 15:00（日本時間）`（注記つき。見出しのない一覧や単発の時刻用）。 */
export function formatDateTimeJSTWithNote(value: string | number | Date | null | undefined): string {
  const s = formatDateTimeJST(value);
  return s === UNKNOWN_TIME_LABEL ? s : `${s}${JST_NOTE}`;
}

/**
 * フォーマット済みの文字列に「（日本時間）」を付けるヘルパー。
 * `日時不明` には注記を付けない（「日時不明（日本時間）」という不自然な表記を避ける）。
 */
export function jstNote(formatted: string): string {
  return formatted === UNKNOWN_TIME_LABEL ? '' : JST_NOTE;
}

/**
 * 時間帯 `15:00〜16:00`。同じ日内なら時刻だけ、日付をまたぐなら両端に日付を付ける
 * （例 `2026/11/10 23:45〜2026/11/11 00:00`）。不正なら `日時不明`。
 */
export function formatTimeRangeJST(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
): string {
  const a = toDateOrNull(start);
  const b = toDateOrNull(end);
  if (!a || !b) return UNKNOWN_TIME_LABEL;
  const sameDay = formatWith(dateFmt, a) === formatWith(dateFmt, b);
  try {
    if (sameDay) return `${timeFmt.format(a)}〜${timeFmt.format(b)}`;
    return `${dateTimeFmt.format(a)}〜${dateTimeFmt.format(b)}`;
  } catch {
    return UNKNOWN_TIME_LABEL;
  }
}

/** 開始時刻 + 期間（分）の時間帯。 */
export function formatMinutesRangeJST(
  start: string | number | Date | null | undefined,
  minutes: number,
): string {
  const a = toDateOrNull(start);
  if (!a || !Number.isFinite(minutes) || minutes <= 0) return UNKNOWN_TIME_LABEL;
  return formatTimeRangeJST(a, a.getTime() + minutes * 60_000);
}

/**
 * 候補スロットキー（**UTC** "YYYY-MM-DDTHHMM" / 従来の "YYYY-MM-DDTHH"）を ms へ。
 * 形式が違う・不正なら null（表示は `日時不明` に丸める）。
 * ※ ここだけは「UTCの生データを解釈する」関数。JSTへ変換して表示するためだけに使う。
 */
export function parseUtcSlot(slot: string | null | undefined): number | null {
  if (typeof slot !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})?$/.exec(slot);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3] ?? '00'}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** スロット開始（UTCキー）を `2026/11/10 15:00` に。不正なら `日時不明`。 */
export function formatSlotDateTimeJST(slot: string | null | undefined): string {
  const ms = parseUtcSlot(slot);
  return ms === null ? UNKNOWN_TIME_LABEL : formatDateTimeJST(ms);
}

/** スロット開始 + 間隔（分）の時間帯を日本時間で（例 `15:00〜15:15`）。 */
export function formatSlotRangeJST(
  slot: string | null | undefined,
  minutes: number,
): string {
  const ms = parseUtcSlot(slot);
  if (ms === null) return UNKNOWN_TIME_LABEL;
  return formatMinutesRangeJST(ms, minutes);
}
