/**
 * 日時表示の共通関数（issue #18 / JST統一）のテスト。
 * - UTCのISO日時を Asia/Tokyo へ正しく変換する（日付またぎ・年末年始・00時表記）
 * - ブラウザ/OSのタイムゾーン設定に依存しない（TZ=UTC / 海外TZでも同じ結果）
 * - 配合枠（60分・180分・15分）の時間帯が日本時間の境界で表示される
 * - 不正な日時でも例外を出さず「日時不明」
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  JST_NOTE,
  TIME_ZONE,
  UNKNOWN_TIME_LABEL,
  formatDateTimeJST,
  formatDateTimeJSTWithNote,
  formatDateJST,
  formatMinutesRangeJST,
  formatSlotDateTimeJST,
  formatSlotRangeJST,
  formatTimeJST,
  formatTimeRangeJST,
  parseUtcSlot,
  toDateOrNull,
  jstNote,
} from '../lib/datetime.ts';

describe('基本の変換（UTC → JST）', () => {
  it('UTCの日時を日本時間へ変換する', () => {
    expect(TIME_ZONE).toBe('Asia/Tokyo');
    expect(formatDateTimeJST('2026-11-10T06:00:00Z')).toBe('2026/11/10 15:00');
    expect(formatDateJST('2026-11-10T06:00:00Z')).toBe('2026/11/10');
    expect(formatTimeJST('2026-11-10T06:00:00Z')).toBe('15:00');
    // 秒は表示しない
    expect(formatDateTimeJST('2026-11-10T06:00:45Z')).toBe('2026/11/10 15:00');
  });

  it('日付をまたぐ変換が正しい（UTCの日付とJSTの日付がずれる）', () => {
    // UTC 11/09 16:30 = JST 11/10 01:30
    expect(formatDateTimeJST('2026-11-09T16:30:00Z')).toBe('2026/11/10 01:30');
    // UTC 11/10 00:00 = JST 11/10 09:00（同じ日でも日付表示はJST基準）
    expect(formatDateTimeJST('2026-11-10T00:00:00Z')).toBe('2026/11/10 09:00');
  });

  it('年末年始の変換が正しい', () => {
    expect(formatDateTimeJST('2026-12-31T15:30:00Z')).toBe('2027/01/01 00:30');
    expect(formatDateJST('2026-12-31T14:59:00Z')).toBe('2026/12/31'); // 23:59まで当年
    expect(formatDateTimeJST('2027-01-01T00:00:00Z')).toBe('2027/01/01 09:00');
  });

  it('00時は 24:00 にならない（hourCycle: h23）', () => {
    expect(formatDateTimeJST('2026-11-09T15:00:00Z')).toBe('2026/11/10 00:00');
    expect(formatTimeJST('2026-11-09T15:00:00Z')).toBe('00:00');
  });

  it('注記つき表記は「（日本時間）」を付ける', () => {
    expect(formatDateTimeJSTWithNote('2026-11-10T06:00:00Z')).toBe(
      `2026/11/10 15:00${JST_NOTE}`,
    );
    expect(JST_NOTE).toBe('（日本時間）');
    expect(formatDateTimeJSTWithNote('n/a')).toBe(UNKNOWN_TIME_LABEL);
    // 「日時不明（日本時間）」という不自然な表記は作らない
    expect(jstNote(formatDateTimeJST('n/a'))).toBe('');
    expect(jstNote(formatDateTimeJST('2026-11-10T06:00:00Z'))).toBe(JST_NOTE);
  });
});

describe('タイムゾーン設定に依存しない', () => {
  const script = [
    `import { formatDateTimeJST, formatSlotRangeJST } from ${JSON.stringify(
      fileURLToPath(new URL('../lib/datetime.ts', import.meta.url)),
    )};`,
    `console.log(formatDateTimeJST('2026-11-10T06:00:00Z'));`,
    `console.log(formatSlotRangeJST('2026-11-09T1500', 60));`,
  ].join('\n');

  const runWithTz = (tz: string): string =>
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    }).trim();

  it('TZ=UTC でも TZ=海外 でも日本時間で表示される（issue #9 の確認項目）', () => {
    const expected = ['2026/11/10 15:00', '00:00〜01:00'].join('\n');
    expect(runWithTz('UTC')).toBe(expected);
    expect(runWithTz('America/New_York')).toBe(expected);
    expect(runWithTz('Asia/Tokyo')).toBe(expected);
  });
});

describe('時間帯（配合枠）の表示', () => {
  it('60分枠は日本時間の毎時0分が境界になる', () => {
    // UTC 15:00 = JST 翌日 00:00（issue #18 §7 の例: 00:00〜01:00）
    expect(formatSlotDateTimeJST('2026-11-09T1500')).toBe('2026/11/10 00:00');
    expect(formatSlotRangeJST('2026-11-09T1500', 60)).toBe('00:00〜01:00');
    // 15分枠（現在の設定）と60分枠: 同じ日内なら時刻だけ
    expect(formatSlotRangeJST('2026-11-10T0600', 15)).toBe('15:00〜15:15');
    expect(formatSlotRangeJST('2026-11-10T0600', 60)).toBe('15:00〜16:00');
    // 時間帯が日跨ぎする場合は両端に日付（UTC 14:30 = JST 23:30 → 翌00:30）
    expect(formatSlotRangeJST('2026-11-09T1430', 60)).toBe(
      '2026/11/09 23:30〜2026/11/10 00:30',
    );
  });

  it('180分枠は日本時間の 00/03/06 時台で区切られる', () => {
    expect(formatSlotRangeJST('2026-11-09T1500', 180)).toBe('00:00〜03:00');
    expect(formatSlotRangeJST('2026-11-09T1800', 180)).toBe('03:00〜06:00');
    expect(formatSlotRangeJST('2026-11-09T2100', 180)).toBe('06:00〜09:00');
    // UTC の枠境界（15:00/18:00/21:00）は JST では 00/03/06 時台 = 表示時間帯と実枠が一致
  });

  it('日付をまたぐ時間帯は両端に日付を出す', () => {
    // UTC 14:30 = JST 23:30 → +60分で日跨ぎ
    expect(formatMinutesRangeJST('2026-11-09T14:30:00Z', 60)).toBe(
      '2026/11/09 23:30〜2026/11/10 00:30',
    );
    expect(formatTimeRangeJST('2026-11-10T06:00:00Z', '2026-11-10T07:30:00Z')).toBe(
      '15:00〜16:30',
    );
  });

  it('スロットキー（UTC "YYYY-MM-DDTHHMM" と従来 "YYYY-MM-DDTHH"）を解釈する', () => {
    const hhmm = parseUtcSlot('2026-11-09T1715');
    expect(hhmm).toBe(Date.parse('2026-11-09T17:15:00Z'));
    expect(parseUtcSlot('2026-11-09T17')).toBe(Date.parse('2026-11-09T17:00:00Z'));
    // 表示は日本時間（UTC 17:15 = JST 翌日 02:15）
    expect(formatSlotDateTimeJST('2026-11-09T1715')).toBe('2026/11/10 02:15');
    // 不正なキーは null / 日時不明
    expect(parseUtcSlot('today')).toBeNull();
    expect(parseUtcSlot('2026-11-09')).toBeNull();
    expect(parseUtcSlot('')).toBeNull();
    expect(formatSlotDateTimeJST('today')).toBe(UNKNOWN_TIME_LABEL);
    expect(formatSlotRangeJST('today', 60)).toBe(UNKNOWN_TIME_LABEL);
  });
});

describe('不正な日時は画面を壊さない', () => {
  it('不正値はすべて「日時不明」（例外を投げない）', () => {
    const bad: unknown[] = ['', 'not-a-date', null, undefined, Number.NaN, '2026-99-99T99:99:99Z'];
    for (const v of bad) {
      expect(toDateOrNull(v as never)).toBeNull();
      expect(formatDateTimeJST(v as never)).toBe(UNKNOWN_TIME_LABEL);
      expect(formatDateJST(v as never)).toBe(UNKNOWN_TIME_LABEL);
      expect(formatTimeJST(v as never)).toBe(UNKNOWN_TIME_LABEL);
      expect(formatMinutesRangeJST(v as never, 60)).toBe(UNKNOWN_TIME_LABEL);
    }
    expect(formatTimeRangeJST('bad', 'bad')).toBe(UNKNOWN_TIME_LABEL);
    expect(formatMinutesRangeJST('2026-11-10T06:00:00Z', -5)).toBe(UNKNOWN_TIME_LABEL);
    expect(formatMinutesRangeJST('2026-11-10T06:00:00Z', Number.NaN)).toBe(UNKNOWN_TIME_LABEL);
  });

  it('Date・数値（ms）も受け付ける', () => {
    const ms = Date.parse('2026-11-10T06:00:00Z');
    expect(formatDateTimeJST(ms)).toBe('2026/11/10 15:00');
    expect(formatDateTimeJST(new Date(ms))).toBe('2026/11/10 15:00');
  });
});
