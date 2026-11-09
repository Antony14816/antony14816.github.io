/**
 * 配合フロー状態判定（issue #11 最重要事項: リアクションは実際の処理状態と連動）。
 * - Issue作成画面を開いただけ ≠ 申請完了（success にしない）
 * - 申請完了は API が Issue（タイトル+本文の親ID行）を返したときだけ
 * - 配合待ち / 生成中 / 誕生 を区別し、sample サブセットで誕生判定を誤らせない
 */
import { expect, it } from 'vitest';
import type { Offspring } from '../lib/types.ts';
import {
  applyView,
  breedTitle,
  findOpenedIssue,
  observeBreeding,
  observeView,
  parseBreedIssueTitle,
  CONFIRM_DELAYS_MS,
  type SeenIssue,
} from '../public/breeding-state.ts';

const PAIR = { parentA: 'protopedia:1234', parentB: 'protopedia:5678' };

function issue(over: Partial<SeenIssue> = {}): SeenIssue {
  return {
    number: 1,
    title: breedTitle(PAIR),
    body: `parent_a: ${PAIR.parentA}\nparent_b: ${PAIR.parentB}\nmode: fusion`,
    state: 'open',
    createdAt: '2026-11-09T12:00:00Z',
    ...over,
  };
}

function child(over: Partial<Offspring> = {}): Offspring {
  return {
    id: 'mashup-000001',
    schemaVersion: 1,
    title: '子',
    summary: 's',
    concept: 'c',
    mechanism: 'm',
    inheritedTraits: [],
    parents: ['protopedia:1', 'protopedia:2'],
    generation: 1,
    mode: 'fusion',
    sourceIssue: 7,
    slot: '2026-11-09T12',
    createdAt: '2026-11-09T12:10:00Z',
    model: 'test/model',
    status: 'idea',
    ...over,
  };
}

// --- タイトル・照合 -----------------------------------------------------------

it('表示用タイトルの生成とパース（互いに往復する）', () => {
  expect(breedTitle(PAIR)).toBe('[Breed] protopedia:1234 x protopedia:5678');
  expect(parseBreedIssueTitle(breedTitle(PAIR))).toEqual(PAIR);
  expect(parseBreedIssueTitle('[Breed] mashup-000001 x protopedia:12')).toEqual({
    parentA: 'mashup-000001',
    parentB: 'protopedia:12',
  });
});

it('配合形式以外のタイトルは受け付けない / 長すぎるIDは拒否', () => {
  expect(parseBreedIssueTitle('Bug: something')).toBeNull();
  expect(parseBreedIssueTitle('[Breed] only-one')).toBeNull();
  expect(parseBreedIssueTitle(`[Breed] ${'a'.repeat(65)} x protopedia:1`)).toBeNull();
});

it('findOpenedIssue: タイトル+本文の親ID行+時間窓が揃ってはじめて一致', () => {
  const openedAtMs = Date.parse('2026-11-09T11:59:00Z');
  expect(findOpenedIssue([issue()], PAIR, openedAtMs)).not.toBeNull();
  // 本文に親ID行がない（=正規の入力元を満たさない）タイトルだけのIssueは却下
  expect(
    findOpenedIssue([issue({ body: '何かの本文' })], PAIR, openedAtMs),
  ).toBeNull();
  // 別の組み合わせの本文なら一致しない
  expect(
    findOpenedIssue(
      [issue({ body: 'parent_a: protopedia:9999\nparent_b: protopedia:5678' })],
      PAIR,
      openedAtMs,
    ),
  ).toBeNull();
  // 開く前から存在した同名Issue（過去のセッション）は時間窓で除外
  expect(
    findOpenedIssue([issue({ createdAt: '2026-11-01T00:00:00Z' })], PAIR, openedAtMs),
  ).toBeNull();
});

// --- 申請フェーズ -------------------------------------------------------------

it('opening は success にしない（Issue作成画面を開いただけでは申請完了と判定しない）', () => {
  const opening = applyView('opening');
  expect(opening.state).not.toBe('success');
  expect(opening.state).toBe('idle');
  expect(opening.message).toContain('送信');
  expect(opening.message).toContain('開いただけでは申請になりません');
});

it('confirmed のみが success。unconfirmed は正直に未確認のまま', () => {
  expect(applyView('confirmed').state).toBe('success');
  expect(applyView('unconfirmed').state).toBe('idle');
  expect(applyView('unconfirmed').message).toContain('まだ申し込みを確認できません');
  expect(applyView('idle').state).toBe('idle');
});

it('確認ポーリングは上限つき（最大10回・約3.5分で必ず停止）', () => {
  expect(CONFIRM_DELAYS_MS.length).toBeLessThanOrEqual(10);
  const total = CONFIRM_DELAYS_MS.reduce((a, b) => a + b, 0);
  expect(total).toBeLessThanOrEqual(4 * 60_000);
});

// --- 観測フェーズ -------------------------------------------------------------

it('fresh: 直近90分に生まれた本番子作品があれば最優先で fresh', () => {
  const nowMs = Date.parse('2026-11-09T12:30:00Z');
  const phase = observeBreeding({
    issues: [issue()], // open でも fresh が上書きする
    offspring: [child()],
    nowMs,
  });
  expect(phase).toBe('fresh');
});

it('sample の子作品や sourceIssue 0 では誕生と判定しない', () => {
  const nowMs = Date.parse('2026-11-09T12:30:00Z');
  expect(
    observeBreeding({ issues: [], offspring: [child({ sample: true })], nowMs }),
  ).toBe('nothing');
  expect(
    observeBreeding({ issues: [], offspring: [child({ sourceIssue: 0 })], nowMs }),
  ).toBe('nothing');
  // 90分を過ぎた誕生は fresh ではない（ただし公開 Issue があれば queued/generating）
  expect(
    observeBreeding({
      issues: [],
      offspring: [child({ createdAt: '2026-11-09T09:00:00Z' })],
      nowMs,
    }),
  ).toBe('nothing');
});

it('generating: closed だが未公開（=ワーカー処理中）。queued=open と区別する', () => {
  const nowMs = Date.parse('2026-11-09T12:30:00Z');
  expect(
    observeBreeding({ issues: [issue({ state: 'closed' })], offspring: [], nowMs }),
  ).toBe('generating');
  expect(
    observeBreeding({ issues: [issue({ state: 'open' })], offspring: [], nowMs }),
  ).toBe('queued');
  // closed で sourceIssue が公開済み → これは過去の完了であって処理中ではない
  expect(
    observeBreeding({
      issues: [issue({ state: 'closed', number: 7 })],
      offspring: [child({ createdAt: '2026-11-09T09:00:00Z' })],
      nowMs,
    }),
  ).toBe('nothing');
  // 配合形式でない Issue は観測に混ざらない
  expect(
    observeBreeding({
      issues: [issue({ title: 'Bug report', state: 'open' })],
      offspring: [],
      nowMs,
    }),
  ).toBe('nothing');
});

it('observeView: 配合待ち / 生成中 / 誕生でセリフと状態が明確に違う', () => {
  const queued = observeView('queued');
  expect(queued.higedaruma.state).toBe('idle');
  expect(queued.higedaruma.message).toContain('配合待ち');
  expect(queued.bothState).toBe('idle');

  const generating = observeView('generating');
  expect(generating.higedaruma.state).toBe('thinking');
  expect(generating.higedaruma.message).toContain('生成中');
  expect(generating.bothState).toBe('idle'); // 生成中は誕生を装わない

  const fresh = observeView('fresh');
  expect(fresh.higedaruma.state).toBe('celebration');
  expect(fresh.greeting).toBe('なんと！あた新しい発明が誕生したぞ！');
  expect(fresh.bothState).toBe('celebration');

  expect(observeView('nothing').higedaruma.state).toBe('idle');
});
