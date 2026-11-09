import { describe, expect, it } from 'vitest';
import {
  CANDIDATES_PER_SLOT,
  buildCandidatesFile,
  candidateSlotKey,
  hashSlot,
  isCandidatesFile,
  nextSlotKey,
  selectCandidates,
} from '../lib/candidates.ts';
import { PROTOPEDIA_SITE_BASE } from '../lib/protopedia.ts';
import type { ProtopediaWork } from '../lib/types.ts';

function work(n: number): ProtopediaWork {
  return {
    id: `protopedia:${n}`,
    title: `作品${n}`,
    sourceUrl: `${PROTOPEDIA_SITE_BASE}/prototype/${n}`,
    summary: 's',
    generation: 0,
  };
}

const pool = Array.from({ length: 12 }, (_, i) => work(i + 1));

describe('selectCandidates', () => {
  it('同じスロットなら常に同じ候補（決定的選出）', () => {
    const a = selectCandidates(pool, '2026-11-09T1400').map((w) => w.id);
    const b = selectCandidates(pool, '2026-11-09T1400').map((w) => w.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(CANDIDATES_PER_SLOT);
  });

  it('入力ファイルの並び順に依存しない（ID昇順で正規化してから選ぶ）', () => {
    const reversed = [...pool].reverse();
    const a = selectCandidates(pool, '2026-11-09T1400').map((w) => w.id);
    const b = selectCandidates(reversed, '2026-11-09T1400').map((w) => w.id);
    expect(a).toEqual(b);
  });

  it('重複したIDを排除し、候補にも重複は出ない', () => {
    const dup = [...pool, ...pool.slice(0, 3)];
    const picked = selectCandidates(dup, '2026-11-09T1400');
    const ids = picked.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(picked.length).toBeLessThanOrEqual(CANDIDATES_PER_SLOT);
  });

  it('異なるスロットは（ほぼ確実に）別の並びになる', () => {
    const a = selectCandidates(pool, '2026-11-09T1400').map((w) => w.id);
    const b = selectCandidates(pool, '2026-11-09T1415').map((w) => w.id);
    expect(a).not.toEqual(b);
    // 1枠6件の全ユーザー共通はスロットに従う（プール内なら常に同じメンバー集合）
    expect(a).toHaveLength(CANDIDATES_PER_SLOT);
  });

  it('プールが6件未満ならその件数まで（15分枠あたり「最大」6件）', () => {
    const small = [work(3), work(1), work(2)];
    expect(selectCandidates(small, '2026-11-09T1400')).toHaveLength(3);
  });

  it('プールが空なら空配列', () => {
    expect(selectCandidates([], '2026-11-09T1400')).toEqual([]);
  });

  it('hashSlot は同じ入力で同じ値', () => {
    expect(hashSlot('2026-11-09T1400')).toBe(hashSlot('2026-11-09T1400'));
    expect(hashSlot('2026-11-09T1400')).not.toBe(hashSlot('2026-11-09T1415'));
  });
});

describe('candidateSlotKey（15分境界への切り下げ）', () => {
  it('UTCの15分枠（00/15/30/45）へ切り下げて HHMM を返す', () => {
    expect(candidateSlotKey(new Date('2026-11-09T14:04:59Z'))).toBe('2026-11-09T1400');
    expect(candidateSlotKey(new Date('2026-11-09T14:19:00Z'))).toBe('2026-11-09T1415');
    expect(candidateSlotKey(new Date('2026-11-09T14:44:00Z'))).toBe('2026-11-09T1430');
    expect(candidateSlotKey(new Date('2026-11-09T14:59:59Z'))).toBe('2026-11-09T1445');
  });

  it('15分枠内の異なる時刻でも同じスロット（再実行でも候補が変わらない）', () => {
    expect(candidateSlotKey(new Date('2026-11-09T14:04:00Z'))).toBe(
      candidateSlotKey(new Date('2026-11-09T14:14:00Z')),
    );
  });

  it('日跨ぎも正しく切り下げる', () => {
    expect(candidateSlotKey(new Date('2026-11-09T23:50:00Z'))).toBe('2026-11-09T2345');
  });
});

describe('nextSlotKey', () => {
  it('次の15分枠へ進める（日跨ぎ・枠跨ぎを含む）', () => {
    expect(nextSlotKey('2026-11-09T1400')).toBe('2026-11-09T1415');
    expect(nextSlotKey('2026-11-09T1445')).toBe('2026-11-09T1500');
    expect(nextSlotKey('2026-11-09T2345')).toBe('2026-11-10T0000');
    expect(nextSlotKey('2026-12-31T2345')).toBe('2027-01-01T0000');
  });

  it('形式不正は例外（従来の時間枠 HH も受付けない）', () => {
    expect(() => nextSlotKey('2026-11-09')).toThrow('slot');
    expect(() => nextSlotKey('2026-11-09T14')).toThrow('slot');
    expect(() => nextSlotKey('bad')).toThrow('slot');
  });
});

describe('buildCandidatesFile', () => {
  it('slot / generatedAt / nextSlot / 候補を記録する', () => {
    const now = new Date('2026-11-09T14:05:00Z');
    const f = buildCandidatesFile(pool, '2026-11-09T1400', 'data/sample-prototypes.json', now);
    expect(f.schemaVersion).toBe(1);
    expect(f.slot).toBe('2026-11-09T1400');
    expect(f.generatedAt).toBe('2026-11-09T14:05:00.000Z');
    expect(f.nextSlot).toBe('2026-11-09T1415');
    expect(f.source).toBe('data/sample-prototypes.json');
    expect(f.candidates).toHaveLength(CANDIDATES_PER_SLOT);
    expect(isCandidatesFile(f)).toBe(true);
  });

  it('プール0件は例外（既存JSONを更新させない）', () => {
    expect(() => buildCandidatesFile([], '2026-11-09T1400', 'x')).toThrow('プール');
  });
});

describe('isCandidatesFile（フロント読み込みガード）', () => {
  const valid = () =>
    buildCandidatesFile(pool, '2026-11-09T1400', 'data/sample-prototypes.json', new Date('2026-11-09T14:01:00Z'));

  it('正常な形を通す', () => {
    expect(isCandidatesFile(valid())).toBe(true);
  });

  it('オブジェクトでない・欠損・型不正を拒否する', () => {
    expect(isCandidatesFile(null)).toBe(false);
    expect(isCandidatesFile([])).toBe(false);
    expect(isCandidatesFile({ schemaVersion: 2 })).toBe(false);
    const f = valid();
    expect(isCandidatesFile({ ...f, slot: 'bad' })).toBe(false);
    expect(isCandidatesFile({ ...f, candidates: [] })).toBe(false);
    expect(isCandidatesFile({ ...f, generatedAt: 'not-a-date' })).toBe(false);
  });

  it('候補が7件以上（15分枠6件の上限超過）を拒否する', () => {
    const f = valid();
    expect(isCandidatesFile({ ...f, candidates: [...f.candidates, work(99)] })).toBe(false);
  });

  it('候補内のID重複・不正ID・不正URLを拒否する', () => {
    const f = valid();
    expect(isCandidatesFile({ ...f, candidates: [f.candidates[0], f.candidates[0], ...f.candidates.slice(2)] })).toBe(
      false,
    );
    expect(
      isCandidatesFile({
        ...f,
        candidates: [{ ...f.candidates[0], id: 'github:1' }, ...f.candidates.slice(1)],
      }),
    ).toBe(false);
    expect(
      isCandidatesFile({
        ...f,
        candidates: [{ ...f.candidates[0], sourceUrl: 'http://insecure' }, ...f.candidates.slice(1)],
      }),
    ).toBe(false);
  });
});
