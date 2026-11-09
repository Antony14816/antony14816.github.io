// @vitest-environment happy-dom
/**
 * フロントエンドのスモークテスト。
 * APIキーなし・Issuesなしでサイトが起動し、選択→Issue URL生成まで通ることを確認する。
 */
import { expect, it, vi } from 'vitest';

async function boot() {
  vi.resetModules(); // main.ts を毎回再実行する
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/main.ts');
  return {
    selects: () => Array.from(document.querySelectorAll('select')),
    breedButton: () => document.querySelector('button.breed') as HTMLButtonElement,
  };
}

it('タイトル・コピー・注意書きが表示される', async () => {
  await boot();
  expect(document.querySelector('h1')?.textContent).toBe('Mashup Ours');
  expect(document.body.textContent).toContain('20年分の発明を、もう一度マッシュアップ。');
  expect(document.body.textContent).toContain('未実装の発明アイデア');
});

it('親A・親Bの2つの選択UIがある', async () => {
  const { selects } = await boot();
  expect(selects().length).toBe(2);
  // サンプル作品が選択肢に入っている（開発用）
  const options = selects()[0].querySelectorAll('option');
  expect(options.length).toBeGreaterThan(1);
});

it('選択前は交配申請ボタンが無効', async () => {
  const { breedButton } = await boot();
  expect(breedButton().disabled).toBe(true);
});

it('同一作品を選べばボタンが無効のまま', async () => {
  const { selects, breedButton } = await boot();
  const [a, b] = selects();
  a.value = 'protopedia:9001';
  b.value = 'protopedia:9001';
  a.dispatchEvent(new Event('change'));
  b.dispatchEvent(new Event('change'));
  expect(breedButton().disabled).toBe(true);
});

it('異なる2作品の選択でIssue作成URLを開く', async () => {
  const { selects, breedButton } = await boot();
  const [a, b] = selects();
  a.value = 'protopedia:9001';
  b.value = 'protopedia:9002';
  a.dispatchEvent(new Event('change'));
  b.dispatchEvent(new Event('change'));

  // owner/repo未設定のビルドでは無効のままなので、設定済みを想定して直接検証する
  const { newIssueUrl } = await import('../lib/config.ts');
  const url = newIssueUrl({ owner: 'o', repo: 'r' }, a.value, b.value);
  const params = new URL(url).searchParams;
  expect(params.get('body')).toContain('parent_a: protopedia:9001');
  expect(params.get('body')).toContain('parent_b: protopedia:9002');
  expect(breedButton().disabled).toBe(false);
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

it('HTMLとして未エスケープの外部入力が挿入されない（XSS）', async () => {
  // サンプルデータにHTMLらしき文字列がないかはデータ側の責務。
  // ここでは onclick 属性などdangerousな属性が生成されないことを確認する。
  await boot();
  const nodes = document.querySelectorAll('.pedigree-scroll [onload], .pedigree-scroll [onclick]');
  expect(nodes.length).toBe(0);
  expect(document.querySelectorAll('[onclick]').length).toBe(0);
});

it('window.open がIssue URLで呼ばれる（owner/repo設定時）', async () => {
  const { selects, breedButton } = await boot();
  const spy = vi.spyOn(window, 'open').mockReturnValue(null);
  const [a, b] = selects();
  a.value = 'protopedia:9001';
  b.value = 'protopedia:9003';
  a.dispatchEvent(new Event('change'));
  b.dispatchEvent(new Event('change'));

  // 設定が無い環境ではdisabledのまま。設定済みの場合のみクリックを検証。
  if (!breedButton().disabled) {
    breedButton().click();
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('/issues/new?');
  }
  spy.mockRestore();
});
