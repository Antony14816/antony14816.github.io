/**
 * Issue種別のラベル分類（issue #13）。
 * - サイトが生成する配合申請だけが breeding-request になる
 * - 形式を本文に引用した機能追加Issueは誤って配合申請にならない
 */
import { expect, it } from 'vitest';
import { classifyIssueKind } from '../scripts/label-issue.ts';

const BREED_BODY = [
  'parent_a: protopedia:4',
  'parent_b: protopedia:22',
  'parent_a_url: https://protopedia.net/prototype/4',
  'mode: fusion',
  'slot: 2026-11-09T12',
].join('\n');

it('[Breed] タイトル + 本文に parent_a/parent_b 行 → breeding-request', () => {
  expect(classifyIssueKind('[Breed] protopedia:4 x protopedia:22', BREED_BODY)).toBe(
    'breeding-request',
  );
});

it('本文に parent 行がなければ配合申請とみなさない（タイトルだけの偽装・単独使用）', () => {
  expect(classifyIssueKind('[Breed] protopedia:4 x protopedia:22', 'いい感じの組み合わせ')).toBe(
    'enhancement',
  );
  expect(classifyIssueKind('[Breed] a x b', null)).toBe('enhancement');
});

it('[Breed] タイトルがなければ機能追加（本文中に形式を引用していても）', () => {
  const featureBody = [
    '仕様確認: `parent_a:` 行は次の形式。',
    '',
    '```',
    'parent_a: protopedia:1',
    'parent_b: protopedia:2',
    '```',
  ].join('\n');
  expect(classifyIssueKind('Issueの本文パース仕様を確認', featureBody)).toBe('enhancement');
});

it('行頭でなければ反応しない（文中の parent_a: 表記）', () => {
  expect(classifyIssueKind('[Breed] x y', '本文に parent_a: を含む説明だけのIssue')).toBe(
    'enhancement',
  );
});
