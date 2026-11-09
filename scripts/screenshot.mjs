/**
 * デザイン確認用スクリーンショット。
 * 使い方:
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/screenshot.mjs
 * 画像は tmp/（gitignore済み）に出力する。
 */
import { chromium } from 'playwright';

const base = process.env.SHOT_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();

async function shot(page, file, opts = {}) {
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(700); // Webフォント読み込み待ち
  await page.screenshot({ path: `tmp/${file}`, fullPage: opts.fullPage ?? true });
  console.log(`saved tmp/${file}`);
}

// デスクトップ全体
const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await shot(desktop, 'shot-desktop.png');

// 家系図のノードをクリックした詳細パネル
await desktop.locator('.pedigree-scroll .node').last().click();
await desktop.locator('.detail').scrollIntoViewIfNeeded();
await desktop.waitForTimeout(300);
await desktop.screenshot({ path: 'tmp/shot-detail.png', fullPage: false });
console.log('saved tmp/shot-detail.png');

// モバイル
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await shot(mobile, 'shot-mobile.png');

await browser.close();
