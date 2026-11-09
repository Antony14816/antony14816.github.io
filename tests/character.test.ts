// @vitest-environment happy-dom
/**
 * 博士キャラクター表示コンポーネント（issue #11 追加指示 §4・§7・§8）。
 * - スプライトURLが状態に応じて切り替わる
 * - 読み上げ重複ルール（セリフあり / なし / 装飾）
 */
import { expect, it } from 'vitest';
import { createCharacter, CHARACTER_LABEL } from '../public/character.ts';

function img(c: ReturnType<typeof createCharacter>): HTMLImageElement {
  return c.el.querySelector('img') as HTMLImageElement;
}

function msg(c: ReturnType<typeof createCharacter>): HTMLParagraphElement {
  return c.el.querySelector('p.char-msg') as HTMLParagraphElement;
}

it('初期状態は idle のスプライトで data-state=idle', () => {
  const c = createCharacter('banno');
  expect(c.el.classList.contains('char')).toBe(true);
  expect(c.el.dataset.char).toBe('banno');
  expect(c.el.dataset.state).toBe('idle');
  expect(img(c).getAttribute('src')).toMatch(/banno.*idle|idle.*banno/);
  expect(c.getState()).toBe('idle');
});

it('setState で data-state とスプライトが同時に切り替わる', () => {
  const c = createCharacter('higedaruma', { state: 'idle' });
  c.setState('thinking');
  expect(c.el.dataset.state).toBe('thinking');
  expect(img(c).getAttribute('src')).toMatch(/higedaruma.*thinking|thinking.*higedaruma/);
  c.setState('celebration');
  expect(img(c).getAttribute('src')).toMatch(/celebration/);
});

it('セリフがあるとき: img は alt=""（セリフだけが読み上げられる・重複しない）', () => {
  const c = createCharacter('banno', { message: '候補から2つえらんでね。' });
  expect(img(c).alt).toBe('');
  expect(msg(c).hidden).toBe(false);
  expect(msg(c).textContent).toBe('候補から2つえらんでね。');
  // root 側に role/aria-label を付けない（セリフと二重読み上げになるため）
  expect(c.el.hasAttribute('role')).toBe(false);
  expect(c.el.hasAttribute('aria-label')).toBe(false);
});

it('セリフがないとき: role=img + aria-label で名前と状態を1回だけ読む', () => {
  const c = createCharacter('higedaruma');
  expect(msg(c).hidden).toBe(true);
  expect(c.el.getAttribute('role')).toBe('img');
  expect(c.el.getAttribute('aria-label')).toBe(
    `${CHARACTER_LABEL.higedaruma}（通常）`,
  );
  // 状態が変わったらラベルも追随する
  c.setState('success');
  expect(c.el.getAttribute('aria-label')).toContain('よろこぶ顔');
});

it('セリフを後から付けると role=img は外れ、消すと戻る', () => {
  const c = createCharacter('banno');
  c.setMessage('あと1つ！');
  expect(c.el.hasAttribute('role')).toBe(false);
  expect(msg(c).hidden).toBe(false);
  c.setMessage(null);
  expect(msg(c).hidden).toBe(true);
  expect(c.el.getAttribute('role')).toBe('img');
});

it('装飾指定は完全に aria-hidden（系譜図の補助表示など）', () => {
  const c = createCharacter('banno', { decorative: true });
  expect(c.el.getAttribute('aria-hidden')).toBe('true');
  expect(c.el.hasAttribute('role')).toBe(false);
  c.setState('celebration'); // 状態を変えても装飾のまま
  expect(c.el.getAttribute('aria-hidden')).toBe('true');
  expect(c.el.hasAttribute('aria-label')).toBe(false);
});

it('実像素をimgの寸法属性で宣言する（CLS防止）', () => {
  const c = createCharacter('banno');
  expect(img(c).width).toBe(135);
  expect(img(c).height).toBe(268);
});
