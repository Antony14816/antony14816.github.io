// @vitest-environment happy-dom
/**
 * /ideas アイデア一覧ページ（issue #8）。
 * 空状態・一覧の件数とバッジ・親リンク・出典Issueリンク・XSS安全を確認する。
 */
import { expect, it } from 'vitest';
import type { Offspring } from '../lib/types.ts';
import sampleOffspring from '../data/offspring.sample.json';
import { buildIdeasPage, type IdeasContext } from '../src/ideas.ts';

const fixtures = sampleOffspring as unknown as Offspring[];

const ctx: IdeasContext = {
  repoCfg: { owner: 'test-owner', repo: 'test-repo' },
  base: '/',
};

function build(list: Offspring[], c: IdeasContext = ctx): HTMLElement {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  buildIdeasPage(host, list, c);
  return host;
}

it('0件のときは空状態と申請誘導を表示する', () => {
  const host = build([]);
  const text = host.textContent ?? '';
  expect(text).toContain('まだアイデアは生まれていません');
  expect(text).toContain('交配を申請');
  expect(text).toContain('全0件');
  expect(host.querySelectorAll('.idea-item').length).toBe(0);
  // 戻るリンクはトップ
  const back = host.querySelector<HTMLAnchorElement>('header.hero a');
  expect(back?.getAttribute('href')).toBe('/');
});

it('一覧は新しい順に件数どおり並び、世代・未実装バッジが付く', () => {
  const host = build(fixtures);
  const items = Array.from(host.querySelectorAll<HTMLElement>('.idea-item'));
  expect(items.length).toBe(fixtures.length);
  // createdAt 降順: mashup-000002（11/08 11:05Z）が先頭
  expect(items[0].dataset.id).toBe('mashup-000002');
  expect(items[0].querySelector('.badge.idea')?.textContent).toBe('未実装のアイデア');
  expect(items[0].querySelector('.badge.gen')?.textContent).toBe('第2世代');
  expect(items[0].querySelector('.badge.sample')?.textContent).toBe('SAMPLE');
  expect(host.textContent).toContain('全2件');
  expect(host.textContent).toMatch(/生成: .*JST/);
  // 詳細リンクはトップの ?id= ディープリンク
  const detail = items[0].querySelector<HTMLAnchorElement>('a.idea-detail');
  expect(detail?.getAttribute('href')).toBe('/?id=mashup-000002');
});

it('親はタイトルでリンクする（子=トップ詳細 / ProtoPedia=出典URL）', () => {
  const host = build(fixtures); // 先頭は mashup-000002（親: mashup-000001 × protopedia:9002）
  const first = host.querySelector<HTMLElement>('.idea-item');
  expect(first).toBeTruthy();
  const links = Array.from(first!.querySelectorAll('.idea-parents a'));
  expect(links.length).toBe(2);
  expect(links[0].getAttribute('href')).toBe('/?id=mashup-000001');
  expect(links[0].textContent).toContain('光る歴史散歩デバイス'); // 読み込み済みのタイトル
  expect(links[1].getAttribute('href')).toBe('https://protopedia.net/prototype/9002');
  expect(links[1].getAttribute('target')).toBe('_blank');
});

it('読み込み済みに無い ProtoPedia 親でも出典URLへリンクする', () => {
  const fx: Offspring = {
    ...fixtures[0],
    id: 'mashup-000099',
    parents: ['protopedia:999999999', 'mashup-000001'] as Offspring['parents'],
    sample: false,
    sourceIssue: 42,
  };
  const host = build([fx]);
  const proto = host.querySelector<HTMLAnchorElement>(
    'a[href="https://protopedia.net/prototype/999999999"]',
  );
  expect(proto).toBeTruthy();
  expect(proto!.textContent).toBe('protopedia:999999999'); // 不明なIDはIDのまま
  // 生成Issueへのリンク（repoCfgあり・Issue番号あり）
  const issue = host.querySelector<HTMLAnchorElement>('a[href$="/issues/42"]');
  expect(issue?.getAttribute('href')).toBe('https://github.com/test-owner/test-repo/issues/42');
  // サンプルでなければ SAMPLE バッジは出ない
  expect(host.querySelector('.badge.sample')).toBeNull();
});

it('sourceIssue 0 や repoCfg 未設定では元Issueリンクを出さない', () => {
  const host = build(fixtures); // 全件 sourceIssue: 0
  expect(host.querySelector('a[href*="/issues/"]')).toBeNull();
  const host2 = build([{ ...fixtures[0], sourceIssue: 7 }], { repoCfg: null, base: '/' });
  expect(host2.querySelector('a[href*="/issues/"]')).toBeNull();
});

it('タイトル等の外部入力をHTMLとして挿入しない（XSS）', () => {
  const evil: Offspring = {
    ...fixtures[0],
    title: '<img src=x onerror=alert(1)>',
    summary: '"><script>alert(2)</script>',
  };
  const host = build([evil]);
  expect(host.querySelector('img, script')).toBeNull();
  expect(host.querySelectorAll('[onclick], [onload], [onerror]').length).toBe(0);
  // テキストとしてそのまま表示される
  expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
});
