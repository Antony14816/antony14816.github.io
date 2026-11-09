// @vitest-environment happy-dom
/**
 * フロントエンドのスモークテスト（候補カードUI / 追加開発指示 §2・§3・§9）。
 * APIキーなし・Issuesなしでサイトが起動し、
 * 「候補6件表示 → 2作品選択 → Issue URL生成」まで通ることを確認する。
 */
import { expect, it, vi } from 'vitest';
import rawCandidates from '../data/current-candidates.json';
import { isCandidatesFile } from '../lib/candidates.ts';

const candFileValid = isCandidatesFile(rawCandidates);
/** 候補JSONが有効なら6件（実データ）、無効なら開発用サンプル4件がカードになる。 */
const expectedCards = candFileValid ? rawCandidates.candidates.length : 4;

async function boot() {
  vi.resetModules(); // main.ts を毎回再実行する
  document.body.innerHTML = '<div id="app"></div>';
  await import('../public/main.ts');
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.candidate'));
  const pickBtn = (cardIdx: number, slot: 'a' | 'b') =>
    cards()[cardIdx].querySelectorAll<HTMLButtonElement>('button.pick')[slot === 'a' ? 0 : 1];
  const statusVals = () => Array.from(document.querySelectorAll<HTMLElement>('.status-val'));
  return {
    cards,
    pickBtn,
    statusVals,
    breedButton: () => document.querySelector('button.breed') as HTMLButtonElement,
    actionHint: () => document.querySelector('.actions .hint') as HTMLElement,
    // select検索フィールドが無いことの確認用
    legacyInputs: () => document.querySelectorAll('select, .filter, .picker'),
  };
}

it('タイトル・コピー・注意書きが表示される', async () => {
  await boot();
  expect(document.querySelector('h1')?.textContent).toBe('Mashup Ours');
  expect(document.body.textContent).toContain('20年分の発明を、もう一度マッシュアップ。');
  expect(document.body.textContent).toContain('未実装の発明アイデア');
});

it('自由検索は廃止され、候補カードだけが並ぶ', async () => {
  const { cards, legacyInputs } = await boot();
  expect(legacyInputs().length).toBe(0); // select・検索フィールド・ピッカーは無い
  expect(cards().length).toBe(expectedCards);

  const ids = cards().map((c) => c.dataset.id ?? 'ID欠落');
  expect(ids.every((id) => /^protopedia:\d{1,9}$/.test(id))).toBe(true);
  expect(new Set(ids).size).toBe(ids.length); // 重複カードは出ない

  // カードごとのNo.キャプション（完成イメージ準拠）
  cards().forEach((c, i) => {
    expect(c.querySelector('.card-index')?.textContent).toBe(
      `作品 No.${String(i + 1).padStart(2, '0')}`,
    );
  });
});

it('パネル見出し「本日の発明研究所」と右上バッジが表示される', async () => {
  await boot();
  expect(document.querySelector('.lab-head h2')?.textContent).toBe('本日の発明研究所');
  expect(document.querySelector('.lab-sub')?.textContent).toBe('LAB / INVENTION CANDIDATES');
  const chip = document.querySelector('.lab-head .chip')?.textContent ?? '';
  expect(chip).toBe(candFileValid ? '毎時6件・全ユーザー共通' : '開発用サンプル');
});

it('画像はlazy読込・alt付き。画像が無いカードはプレースホルダで枠が残る', async () => {
  const { cards } = await boot();
  let boxes = 0;
  for (const c of cards()) {
    const img = c.querySelector<HTMLImageElement>('.thumb img');
    const ph = c.querySelector('.thumb-ph');
    if (img) {
      expect(img.getAttribute('loading')).toBe('lazy');
      expect((img.alt ?? '').length).toBeGreaterThan(0);
      boxes += 1;
    } else {
      expect(ph).toBeTruthy(); // 画像が無くても thumb 枠は維持される
      boxes += 1;
    }
  }
  expect(boxes).toBe(cards().length);
});

it('候補スロット・次回更新予定・全ユーザー共有の案内がある', async () => {
  await boot();
  const text = document.body.textContent ?? '';
  expect(text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}/); // スロット（UTC）
  expect(text).toContain('次回の候補更新予定');
  expect(text).toContain('1時間に1枠は全ユーザー共有');
  expect(text).toContain('ページを再読み込みしても候補は変わりません');
});

it('選択前は交配申請ボタンが無効', async () => {
  const { breedButton, statusVals } = await boot();
  expect(breedButton().disabled).toBe(true);
  expect(statusVals()[0].textContent).toContain('未選択');
  expect(statusVals()[1].textContent).toContain('未選択');
});

it('1作品だけ選んでは申請できない（A選択中バッジは出る）', async () => {
  const { cards, pickBtn, breedButton, statusVals } = await boot();
  pickBtn(0, 'a').click();

  const card = cards()[0];
  expect(card.classList.contains('is-a')).toBe(true);
  expect(pickBtn(0, 'a').getAttribute('aria-pressed')).toBe('true');

  const badge = card.querySelector<HTMLElement>('.badge.pick-state');
  expect(badge?.hidden).toBe(false);
  expect(badge?.textContent).toBe('親A選択中');

  expect(statusVals()[0].textContent).toContain(card.dataset.id ?? 'ID欠落');
  expect(statusVals()[1].textContent).toContain('未選択');
  expect(breedButton().disabled).toBe(true);
});

it('異なる2作品を選ぶと申請ボタンの条件が揃う', async () => {
  const { cards, pickBtn, breedButton, statusVals, actionHint } = await boot();
  pickBtn(0, 'a').click();
  pickBtn(1, 'b').click();

  expect(statusVals()[0].textContent).toContain(cards()[0].dataset.id ?? 'ID欠落');
  expect(statusVals()[1].textContent).toContain(cards()[1].dataset.id ?? 'ID欠落');
  expect(statusVals()[0].textContent).not.toContain('未選択');
  expect(statusVals()[1].textContent).not.toContain('未選択');
  expect(cards()[1].classList.contains('is-b')).toBe(true);

  // owner/repo設定時は有効、未設定時は案内付きで無効のまま
  if (repoConfigured()) {
    expect(breedButton().disabled).toBe(false);
    expect(actionHint().textContent).toContain('の組み合わせで申請します');
  } else {
    expect(breedButton().disabled).toBe(true);
    expect(actionHint().textContent).toContain('未設定');
  }
});

it('同じ作品をAとBにはできない（選んだ側だけ残って無効のまま）', async () => {
  const { pickBtn, breedButton, statusVals } = await boot();
  pickBtn(0, 'a').click();
  pickBtn(0, 'b').click(); // 同一カード → A選択は解除されてBだけ残る
  expect(statusVals()[0].textContent).toContain('未選択');
  expect(statusVals()[1].textContent).not.toContain('未選択');
  expect(breedButton().disabled).toBe(true);
});

it('もう一度押すと選択が解除される', async () => {
  const { cards, pickBtn, statusVals } = await boot();
  pickBtn(0, 'a').click();
  pickBtn(0, 'a').click(); // トグル解除
  expect(cards()[0].classList.contains('is-a')).toBe(false);
  expect(pickBtn(0, 'a').getAttribute('aria-pressed')).toBe('false');
  expect(cards()[0].querySelector<HTMLElement>('.badge.pick-state')?.hidden).toBe(true);
  expect(statusVals()[0].textContent).toContain('未選択');
});

it('Issue作成URLに親ID・元作品URL・slotが含まれる（設定済み環境）', async () => {
  const { pickBtn, breedButton } = await boot();
  const spy = vi.spyOn(window, 'open').mockReturnValue(null);
  pickBtn(0, 'a').click();
  pickBtn(1, 'b').click();

  // owner/repo未設定のビルドでは無効のままなので、設定済みの場合のみクリックを検証する
  if (!breedButton().disabled) {
    breedButton().click();
    expect(spy).toHaveBeenCalledTimes(1);
    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.pathname).toContain('/issues/new');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('parent_a: ');
    expect(body).toContain('parent_b: ');
    expect(body).toContain('parent_a_url: https://protopedia.net/');
    expect(body).toContain('slot: ');
  }
  spy.mockRestore();
});

it('家系図SVGとノードが描画される（サンプル2世代）', async () => {
  await boot();
  const svg = document.querySelector('.pedigree-scroll svg');
  expect(svg).toBeTruthy();
  const nodes = document.querySelectorAll('.pedigree-scroll .node');
  // サンプル系譜に絡むノード: protopedia:9001/9002/9004 + mashup-000001/000002 = 5
  // （系譜に未接続の protopedia:9003 は家系図に出さない）
  expect(nodes.length).toBe(5);
  const edges = document.querySelectorAll('.pedigree-scroll .edge');
  expect(edges.length).toBe(4); // 各子に親2本 × 2子
});

it('子作品ノードをクリックすると詳細が出る', async () => {
  await boot();
  const nodes = Array.from(document.querySelectorAll('.pedigree-scroll .node'));
  (nodes[nodes.length - 1] as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const detail = document.querySelector('.detail')?.textContent ?? '';
  expect(detail).toContain('継承した特徴');
  expect(detail).toContain('未実装の発明アイデア');
});

it('子作品の行からも親を選びられる（行クリックの詳細表示は奪わない）', async () => {
  const { statusVals } = await boot();
  const li = document.querySelector<HTMLElement>('ul.offspring li:not(.empty)');
  expect(li).toBeTruthy();
  const btns = li!.querySelectorAll<HTMLButtonElement>('button.pick');
  expect(btns.length).toBe(2); // Aにする / Bにする

  btns[0].click();
  expect(li!.classList.contains('is-a')).toBe(true);
  expect(statusVals()[0].textContent).not.toContain('未選択');
  // 行クリックによる詳細表示は発火しない（stopPropagation）
  expect(document.querySelector('.detail')?.textContent ?? '').toContain('ノードをクリック');
});

it('HTMLとして未エスケープの外部入力が挿入されない（XSS）', async () => {
  // ここでは onclick 属性などdangerousな属性が生成されないことを確認する。
  await boot();
  const nodes = document.querySelectorAll('.pedigree-scroll [onload], .pedigree-scroll [onclick]');
  expect(nodes.length).toBe(0);
  expect(document.querySelectorAll('[onclick]').length).toBe(0);
});

it('?id= ディープリンクで詳細を開く（/ideasからの復帰 / issue #8）', async () => {
  window.history.replaceState({}, '', '/?id=mashup-000001');
  await boot();
  const detail = document.querySelector('.detail')?.textContent ?? '';
  expect(detail).toContain('継承した特徴'); // 子ノードの詳細が初期表示される
  expect(detail).not.toContain('ノードをクリック');
  window.history.replaceState({}, '', '/'); // 後続テストに影響しないよう戻す
});

it('/ideas へのリンクがトップから張られている（issue #8）', async () => {
  await boot();
  const hrefs = Array.from(document.querySelectorAll<HTMLAnchorElement>('h2 a')).map(
    (a) => a.getAttribute('href') ?? '',
  );
  // base パス部分は環境依存（ローカル '/'・Actions '/<repo>/'）なので末尾一致で判定
  expect(hrefs.some((h) => h.endsWith('ideas/'))).toBe(true);
});

/** owner/repoが設定されているか（main.tsの初期化時点と同じ情報を再利用） */
function repoConfigured(): boolean {
  return document.querySelectorAll('.notice.error').length === 0;
}
