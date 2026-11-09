/**
 * デザイン確認用スクリーンショット（ダーク / ライト両テーマ）。
 * 使い方:
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/screenshot.mjs
 * 画像は tmp/（gitignore済み）に出力する。
 */
import { chromium } from 'playwright';

const base = process.env.SHOT_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();

/** テーマを固定したページを作る（localStorage を初期化してから読む）。 */
async function newThemedPage(viewport, theme) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('mashup-theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
  return page;
}

async function goto(page) {
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800); // Webフォント読み込み待ち
}

// --- デスクトップ: ライト ----------------------------------------------------
const light = await newThemedPage({ width: 1280, height: 900 }, 'light');
await goto(light);
await light.screenshot({ path: 'tmp/shot-desktop-light.png', fullPage: true });
console.log('saved tmp/shot-desktop-light.png');

// ライトの詳細パネル（ノードクリック）
await light.locator('.pedigree-scroll .node').last().click();
await light.locator('.detail').scrollIntoViewIfNeeded();
await light.waitForTimeout(300);
await light.screenshot({ path: 'tmp/shot-detail-light.png', fullPage: false });
console.log('saved tmp/shot-detail-light.png');
await light.close();

// --- デスクトップ: ダーク ----------------------------------------------------
const dark = await newThemedPage({ width: 1280, height: 900 }, 'dark');
await goto(dark);
await dark.screenshot({ path: 'tmp/shot-desktop-dark.png', fullPage: true });
console.log('saved tmp/shot-desktop-dark.png');

// ダークの詳細パネル
await dark.locator('.pedigree-scroll .node').last().click();
await dark.locator('.detail').scrollIntoViewIfNeeded();
await dark.waitForTimeout(300);
await dark.screenshot({ path: 'tmp/shot-detail-dark.png', fullPage: false });
console.log('saved tmp/shot-detail-dark.png');
await dark.close();

// --- モバイル: 両テーマ ------------------------------------------------------
for (const theme of ['light', 'dark']) {
  const mobile = await newThemedPage({ width: 390, height: 844 }, theme);
  await goto(mobile);
  await mobile.screenshot({ path: `tmp/shot-mobile-${theme}.png`, fullPage: true });
  console.log(`saved tmp/shot-mobile-${theme}.png`);
  await mobile.close();
}

await browser.close();
