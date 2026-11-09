/**
 * 博士キャラクター用スプライトの切り出し（issue #11 / 追加指示 §4）。
 *
 * 元: public/static/sprites/研究室キャラのピクセルアニメーション素材集-2.png（1774×887・ラベル付きシート）
 *   ※3枚を個別に直接表示して確認済みの対応（ファイル名と内容は一致しない）:
 *     - 研究室キャラのピクセルアニメーション素材集-2.png = ラベル付きシート（切り出し元はこれ）
 *     - 8ビット研究者ポーズ集-3.png   = 伴野顔の3体大ポーズ（不使用）
 *     - 博士の喜びポーズ三連作-1.png   = ひげだるま顔の3体大ポーズ（不使用）
 *   上段=伴野さん(BANNO) / 下段=ひげだるまさん(HIGEDARUMA)
 *   横4グループ = ①通常・会話 ②いいね・成功 ③ひらめき ④生成完了・大成功（各3コマ）
 *   背景は黒（colorType2 RGB・アルファ無し。クロップ確認済み）。輪郭線も黒地と同色なので
 *   白地前提のフラッドは使わず、非背景マスクを閉削（膨張→収縮）で輪郭を橋渡ししてから
 *   外側フラッドし、シルエットとして透過を決める（輪郭・瞳・服の黒を残す）。
 * 出力: public/assets/characters/{banno,higedaruma}/{idle,success,thinking,celebration}.png
 *
 * 指示書 §4: 「実際のピクセル座標を確認して切り出す。等間隔と仮定しない」
 * → 座標は目視で決めず、インク(非背景)のバンド/クラスタ解析で求めて
 *   mark モードで矩形を重ねて目視確認してから cut する。
 *
 * 使い方:
 *   node scripts/slice-characters.mjs analyze   # バンド・クラスタ座標を出力
 *   node scripts/slice-characters.mjs mark      # 選択矩形を描いた確認画像を tmp/ へ
 *   node scripts/slice-characters.mjs cut       # 8枚を切り出し + プレビュー生成
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SRC = fileURLToPath(new URL('../public/static/sprites/研究室キャラのピクセルアニメーション素材集-2.png', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../public/assets/characters', import.meta.url));
const TMP_DIR = fileURLToPath(new URL('../tmp', import.meta.url));

/** 背景判定: 完全透明 または ほぼ黒（このシートの画布は黒地） */
function isBackground(r, g, b, a) {
  if (a < 10) return true;
  return r <= 12 && g <= 12 && b <= 12;
}

/** 選択矩形（crop確認 + runs解析で確定した実像素。グリッド由来ではない）。
 *  x0,y0,x1,y1 は [x0,x1) [y0,y1)。フレーム選択（目視確定）:
 *  idle       = ①通常・会話 の中間コマ
 *  success    = ②いいね・成功 のウインク+親指+オレンジMarks コマ
 *  thinking   = ③ひらめき の電球コマ（電球・「!」はフレームx範囲内に収まる）
 *  celebration = ④生成完了・大成功 の両手上げ中間コマ（高さ最大＝ peak）
 *  各キャラの4状態を同一キャンバス（maxW×maxH・下端=足元で揃え）に配置してサイズ統一。
 *  ※refine モードが暫定x範囲からバンド内タイトbbox+PAD2で y と端を確定する。 */
const BAND = { banno: [30, 331], higedaruma: [430, 713] };
const PAD = 2;
const PROVISIONAL = {
  banno: { idle: [274, 388], success: [764, 880], thinking: [1166, 1279], celebration: [1480, 1593] },
  higedaruma: { idle: [280, 403], success: [788, 905], thinking: [1177, 1302], celebration: [1477, 1595] },
};
const SELECTION = {
  // refine の出力を貼付済み（crop目視 → runs解析 → refine tight+PAD2 で確定）
  // success は Marks がフレーム境界をまたぐためボックスを Marks まで拡張
  // （x0 = Marksのx0-2）。隣接フレームの混入は所有権フィルタで遮断する。
  // idle(banno) のみ右padを削除（padが隣コマF3の2pxを取り込むため。tightのx1が正しい）。
  banno: {
    idle: [272, 140, 388, 326],
    success: [747, 117, 882, 325],
    thinking: [1164, 75, 1281, 327],
    celebration: [1478, 100, 1595, 327],
  },
  higedaruma: {
    idle: [278, 495, 405, 706],
    success: [775, 480, 907, 706],
    thinking: [1175, 438, 1304, 706],
    celebration: [1475, 472, 1597, 706],
  },
};

async function loadRaw() {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/** インク量プロファイルから横バンド（行の連続区間）を求める */
function rowBands(ink, h) {
  const bands = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && ink[y].some(Boolean);
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      bands.push([start, y]);
      start = -1;
    }
  }
  return bands;
}

/** 指定行範囲のインクから縦罫（列クラスタ）を gap で連結して求める */
function colClusters(ink, h, y0, y1, gap = 0) {
  const cols = [];
  for (let x = 0; x < ink[0].length; x++) {
    let on = false;
    for (let y = y0; y < y1; y++) if (ink[y][x]) { on = true; break; }
    cols.push(on);
  }
  const out = [];
  let start = -1;
  let lastOn = -1;
  for (let x = 0; x <= cols.length; x++) {
    const on = x < cols.length && cols[x];
    if (on) {
      if (start < 0) start = x;
      lastOn = x;
    } else if (start >= 0 && x - lastOn > gap) {
      out.push([start, lastOn + 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, lastOn + 1]);
  return out;
}

/** クラスタの実BoundingBox（x0,y0,x1,y1）を縦方向にも詰めて返す */
function tightBox(ink, w, h, x0, x1) {
  let y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x < x1; x++) {
      if (ink[y][x]) { if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1; }
    }
  }
  return [x0, y0, x1, y1];
}

/** インク領域の連結成分（4連結）。ラベル配列も返す（cut の所有権フィルタ用） */
function componentsL(ink, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const out = [];
  const stack = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const s0 = sy * w + sx;
      if (!ink[sy][sx] || label[s0] >= 0) continue;
      const id = out.length;
      let x0 = sx, y0 = sy, x1 = sx + 1, y1 = sy + 1, area = 0;
      stack.length = 0;
      stack.push(s0);
      label[s0] = id;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p / w) | 0;
        area++;
        if (px < x0) x0 = px; if (px + 1 > x1) x1 = px + 1;
        if (py < y0) y0 = py; if (py + 1 > y1) y1 = py + 1;
        for (const q of [p - 1, p + 1, p - w, p + w]) {
          if (q < 0 || q >= w * h) continue;
          const qx = q % w, qy = (q / w) | 0;
          if (Math.abs(qx - px) + Math.abs(qy - py) !== 1) continue; // 左右のみ（行頭/行末の横断防止）
          if (ink[qy][qx] && label[q] < 0) { label[q] = id; stack.push(q); }
        }
      }
      out.push({ x0, y0, x1, y1, area });
    }
  }
  return { comps: out, label };
}

/** 互換ラッパ（analyze/probe/runs 等はリストだけ欲しい） */
function components(ink, w, h) {
  return componentsL(ink, w, h).comps;
}

/** 1パスの最大値(膨張)/最小値(収縮)フィルタ。横→縦の separable 近似で高速化。 */
function separable(mask, w, h, r, isMax) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 1;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let i = x0; i <= x1; i++) {
        const m = mask[row + i];
        if (isMax ? m > v : m < v) v = m;
      }
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 1;
      for (let i = y0; i <= y1; i++) {
        const m = tmp[i * w + x];
        if (isMax ? m > v : m < v) v = m;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * シルエットマスク（黒地・黒輪郭のための透過判定）。
 * 1) ink = 非背景色の画素
 * 2) 閉削（膨張→収縮, r=BRIDGE）で黒い輪郭の切れ目を橋渡し
 *    → 外側フラッドが輪郭線の内側へ侵入し、線画全体を侵食するのを防ぐ
 * 3) マスク0のうち辺から到達できる領域（＝本物の背景）だけを透過にする。
 *    輪郭に囲まれた内側の黒（服・瞳・口）は到達不可 → 不透明のまま残る。
 * 背景側の隙間（腕と体の間など BRIDGE より広いもの）は透過のまま。
 */
const BRIDGE = 2;
function figureMask(data, w, h, ch) {
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const o = p * ch;
    if (data[o + 3] >= 160 && !isBackground(data[o], data[o + 1], data[o + 2], data[o + 3])) ink[p] = 1;
  }
  const closed = separable(separable(ink, w, h, BRIDGE, true), w, h, BRIDGE, false);
  const exterior = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => {
    if (!closed[p] && !exterior[p]) { exterior[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = exterior[p] ? 0 : 1;
  return out;
}

/** シルエットマスクを行単位のUint8Array配列（components()が使う形）に変換 */
function maskToRows(mask, w, h) {
  return Array.from({ length: h }, (_, y) => mask.subarray(y * w, (y + 1) * w));
}

/** [x0,x1) の横走査で ink 列クラスタを gap 結合して返す */
function colRuns(colOn, x0, x1, gap) {
  const out = [];
  let start = -1, last = -1;
  for (let x = x0; x <= x1; x++) {
    const on = x < x1 && colOn[x];
    if (on) { if (start < 0) start = x; last = x; }
    else if (start >= 0 && x - last > gap) { out.push([start, last + 1]); start = -1; }
  }
  if (start >= 0) out.push([start, last + 1]);
  return out;
}

/** グループ(横4区分)ごとのフレーム横ランを診断出力。SELECTION確定の材料にする。 */
async function runs() {
  const { data, w, h, ch } = await loadRaw();
  const mask = figureMask(data, w, h, ch);
  const ink = maskToRows(mask, w, h);
  const comps = components(ink, w, h).filter((c) => c.area >= 30);
  // グループ名ピル（横長・高さ40〜60）の中心から領域境界を導出
  const labels = comps.filter((c) => {
    const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    return bw >= 200 && bh >= 40 && bh <= 60;
  });
  const rows = [
    // frameBand = フレーム本体のみ（グループ名ピルを含めない）/ labelBand = ピル検出用
    { name: 'banno', y0: 30, y1: 331, ly0: 30, ly1: 400 },
    { name: 'higedaruma', y0: 430, y1: 713, ly0: 430, ly1: 790 },
  ];
  for (const row of rows) {
    const labs = labels.filter((l) => l.y0 >= row.ly0 && l.y1 <= row.ly1).sort((a, b) => a.x0 - b.x0);
    if (labs.length !== 4) throw new Error(`${row.name}: group label ${labs.length}件（4件が必要）`);
    const cs = labs.map((l) => (l.x0 + l.x1) / 2);
    const bounds = [cs[0] - (cs[1] - cs[0]) / 2];
    for (let i = 0; i < 3; i++) bounds.push((cs[i] + cs[i + 1]) / 2);
    bounds.push(cs[3] + (cs[3] - cs[2]) / 2);
    console.log(`\n== ${row.name} band y${row.y0}-${row.y1} labelCenters=${cs.join(',')} bounds=${bounds.map((b) => Math.round(b)).join(',')}`);
    const colOn = new Uint8Array(w);
    for (let y = row.y0; y < row.y1; y++) for (let x = 0; x < w; x++) if (ink[y][x]) colOn[x] = 1;
    const colCnt = new Uint16Array(w);
    for (let y = row.y0; y < row.y1; y++) for (let x = 0; x < w; x++) if (ink[y][x]) colCnt[x]++;
    for (let g = 0; g < 4; g++) {
      const gx0 = Math.max(0, Math.ceil(bounds[g])), gx1 = Math.min(w, Math.floor(bounds[g + 1]));
      const rs = colRuns(colOn, gx0, gx1, 0).filter(([a, b]) => b - a >= 30);
      console.log(` group${g + 1} [${gx0},${gx1}): ` + rs.map(([a, b]) => `[${a},${b}) w=${b - a} maxD=${Math.max(...Array.from(colCnt.slice(a, b)))}`).join(' '));
    }
  }
}

/** 暫定x範囲からバンド内のタイトbbox+PADを計算してSELECTION形式で出力 */
async function refine() {
  const { data, w, h, ch } = await loadRaw();
  const mask = figureMask(data, w, h, ch);
  const out = {};
  for (const [name, states] of Object.entries(PROVISIONAL)) {
    const [by0, by1] = BAND[name];
    out[name] = {};
    for (const [state, [rx0, rx1]] of Object.entries(states)) {
      let x0 = rx1, y0 = by1, x1 = rx0, y1 = by0;
      for (let y = by0; y < by1; y++) {
        for (let x = rx0; x < rx1; x++) {
          if (!mask[y * w + x]) continue;
          if (x < x0) x0 = x;
          if (x + 1 > x1) x1 = x + 1;
          if (y < y0) y0 = y;
          if (y + 1 > y1) y1 = y + 1;
        }
      }
      if (x0 >= x1) throw new Error(`${name}/${state}: ink なし（範囲確認）`);
      out[name][state] = [
        Math.max(0, x0 - PAD), Math.max(0, y0 - PAD),
        Math.min(w, x1 + PAD), Math.min(h, y1 + PAD),
      ];
      console.log(`${name}/${state}: x[${rx0},${rx1}) -> tight (${x0},${y0})-(${x1},${y1}) = ${x1 - x0}x${y1 - y0}`);
    }
  }
  console.log('\nSELECTION = ' + JSON.stringify(out, null, 2));
}

async function analyze() {
  const { data, w, h, ch } = await loadRaw();
  const corner = [data[0], data[1], data[2], data[3]];
  let transparent = 0;
  for (let i = 3; i < data.length; i += ch) if (data[i] < 10) transparent++;
  const mask = figureMask(data, w, h, ch);
  let figPx = 0;
  for (let p = 0; p < w * h; p++) if (mask[p]) figPx++;
  const ink = maskToRows(mask, w, h);
  console.log(`src ${w}x${h} ch=${ch} corner=rgba(${corner}) transparentPx=${transparent} figurePx=${figPx}`);

  const comps = components(ink, w, h);
  const big = comps.filter((c) => c.area >= 30).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  console.log(`components(area>=30): ${big.length}`);
  for (const c of big) {
    const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    const kind = bh >= 150 ? 'FIG  ' : (bw >= 90 && bh <= 110 ? 'label' : 'small');
    console.log(`  ${kind} (${String(c.x0).padStart(4)},${String(c.y0).padStart(3)})-(${String(c.x1).padStart(4)},${String(c.y1).padStart(3)}) ${String(bw).padStart(3)}x${String(bh).padStart(3)} area=${c.area}`);
  }
}

async function mark() {
  // SELECTION の矩形を緑で描画して目視確認用に書き出す
  const { data, w, h, ch } = await loadRaw();
  const buf = Buffer.from(data);
  const draw = (x0, y0, x1, y1) => {
    for (let x = x0; x < x1; x++) for (const y of [y0, y1 - 1]) set(x, y);
    for (let y = y0; y < y1; y++) for (const x of [x0, x1 - 1]) set(x, y);
  };
  const set = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * ch;
    buf[i] = 0; buf[i + 1] = 220; buf[i + 2] = 60; buf[i + 3] = 255;
  };
  let n = 0;
  for (const char of Object.values(SELECTION)) {
    for (const box of Object.values(char)) { draw(...box); n++; }
  }
  console.log(`marked ${n} boxes`);
  await mkdir(TMP_DIR, { recursive: true });
  await sharp(buf, { raw: { width: w, height: h, channels: ch } })
    .png()
    .toFile(fileURLToPath(new URL('../tmp/bbox-check.png', import.meta.url)));
  console.log('wrote tmp/bbox-check.png');
}

async function cut() {
  const { data, w, h, ch } = await loadRaw();
  const mask = figureMask(data, w, h, ch);
  const { comps, label } = componentsL(maskToRows(mask, w, h), w, h);

  // 所有権フィルタ: ボックス（±8px許容）に中心が入る連結成分だけを不透明にする。
  // ボックスをアクセント（電球・Marks）まで拡張しても、隣接フレームの画素は
  // 中心がボックス外なので透過のまま（境界をまたぐ Marks を丸ごと取りに行くため）。
  // ±8pxは合一成分（F2+F3等）の中心がボックス端にピッタリ乗る事故への保险。
  // コマ中心の間隔は約113pxなので誤所有は起きない。
  const TOL = 8;
  const ownershipOf = (x0, y0, x1, y1) => {
    const owned = new Uint8Array(comps.length);
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      if (cx >= x0 - TOL && cx < x1 + TOL && cy >= y0 - TOL && cy < y1 + TOL) owned[i] = 1;
    }
    return owned;
  };

  // キャラごとに4状態を切り出し → 全状態共通のキャンバスへ
  // (下端=足元揃え・中央寄せ・拡縮なし＝比率維持。max寸法は選択結果から自動計算)
  const boxesAll = Object.values(SELECTION).flatMap((c) => Object.values(c));
  const canvasW = Math.max(...boxesAll.map((b) => b[2] - b[0]));
  const canvasH = Math.max(...boxesAll.map((b) => b[3] - b[1]));

  const previewCells = [];
  for (const [name, states] of Object.entries(SELECTION)) {
    await mkdir(`${OUT_DIR}/${name}`, { recursive: true });
    for (const [state, [x0, y0, x1, y1]] of Object.entries(states)) {
      const bw = x1 - x0, bh = y1 - y0;
      const owned = ownershipOf(x0, y0, x1, y1);
      // ボックス全体のRGBAを所有権アルファで作り直してから extract
      const buf = Buffer.alloc(w * h * 4);
      for (let p = 0; p < w * h; p++) {
        const o = p * 4;
        buf[o] = data[o];
        buf[o + 1] = data[o + 1];
        buf[o + 2] = data[o + 2];
        buf[o + 3] = mask[p] && owned[label[p]] ? 255 : 0;
      }
      const canvas = sharp({
        create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      });
      const fig = sharp(buf, { raw: { width: w, height: h, channels: 4 } }).extract({ left: x0, top: y0, width: bw, height: bh });
      const figBuf = await fig.png().toBuffer();
      const top = canvasH - bh; // 足元(下端)揃え
      const left = Math.round((canvasW - bw) / 2);
      const out = await canvas.composite([{ input: figBuf, left, top }]).png({ compressionLevel: 9 }).toBuffer();
      await sharp(out).toFile(`${OUT_DIR}/${name}/${state}.png`);
      console.log(`wrote ${name}/${state}.png (${bw}x${bh} → canvas ${canvasW}x${canvasH})`);
      previewCells.push({ name, state, buf: out, w: canvasW, h: canvasH });
    }
  }

  // 確認用: チェッカー背景に2×4で並べたプレビュー
  const cellW = canvasW + 16, cellH = canvasH + 30;
  const sheetW = cellW * 4, sheetH = cellH * 2;
  const sheet = sharp({
    create: { width: sheetW, height: sheetH, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } },
  });
  const order = ['banno', 'higedaruma'];
  const states = ['idle', 'success', 'thinking', 'celebration'];
  const composite = [];
  for (const [r, name] of order.entries()) {
    for (const [c, st] of states.entries()) {
      const cell = await sharp({
        create: { width: cellW, height: cellH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite([{ input: `${OUT_DIR}/${name}/${st}.png`, left: 8, top: 8 }])
        .png().toBuffer();
      composite.push({ input: cell, left: c * cellW, top: r * cellH });
    }
  }
  await mkdir(TMP_DIR, { recursive: true });
  await sheet.composite(composite).png().toFile(fileURLToPath(new URL('../tmp/characters-preview.png', import.meta.url)));
  console.log('wrote tmp/characters-preview.png');
}

/** 全成分のバウンディングボックスを色分け描画（緑=FIG/赤=ラベル/青=small）して目視確認 */
async function probe() {
  const { data, w, h, ch } = await loadRaw();
  const buf = Buffer.from(data);
  const comps = components(maskToRows(figureMask(data, w, h, ch), w, h), w, h).filter((c) => c.area >= 30);
  const colorOf = (c) => (c.y1 - c.y0 >= 150 ? [0, 220, 60] : (c.x1 - c.x0 >= 90 && c.y1 - c.y0 <= 110 ? [255, 60, 60] : [60, 120, 255]));
  const set = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * ch;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
  };
  for (const c of comps) {
    const rgb = colorOf(c);
    for (let x = c.x0; x < c.x1; x++) { set(x, c.y0, rgb); set(x, c.y1 - 1, rgb); }
    for (let y = c.y0; y < c.y1; y++) { set(c.x0, y, rgb); set(c.x1 - 1, y, rgb); }
  }
  console.log(`probed ${comps.length} boxes`);
  await mkdir(TMP_DIR, { recursive: true });
  await sharp(buf, { raw: { width: w, height: h, channels: ch } }).png().toFile(fileURLToPath(new URL('../tmp/probe.png', import.meta.url)));
  console.log('wrote tmp/probe.png');
}

/** 成分の実画素をクラス別色で塗ったマスクを出力（連結経路の目視調査用） */
async function trace() {
  const { data, w, h, ch } = await loadRaw();
  const ink = maskToRows(figureMask(data, w, h, ch), w, h);
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const s0 = sy * w + sx;
      if (!ink[sy][sx] || label[s0] >= 0) continue;
      const id = comps.length;
      let x0 = sx, y0 = sy, x1 = sx + 1, y1 = sy + 1, area = 0;
      stack.length = 0; stack.push(s0); label[s0] = id;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p / w) | 0;
        area++;
        if (px < x0) x0 = px; if (px + 1 > x1) x1 = px + 1;
        if (py < y0) y0 = py; if (py + 1 > y1) y1 = py + 1;
        for (const q of [p - 1, p + 1, p - w, p + w]) {
          if (q < 0 || q >= w * h) continue;
          const qx = q % w, qy = (q / w) | 0;
          if (Math.abs(qx - px) + Math.abs(qy - py) !== 1) continue;
          if (ink[qy][qx] && label[q] < 0) { label[q] = id; stack.push(q); }
        }
      }
      comps.push({ x0, y0, x1, y1, area });
    }
  }
  // 大成分(>=10000)だけ色を付ける: 緑/赤/青/黄
  const palette = [[0, 255, 0], [255, 40, 40], [60, 120, 255], [255, 220, 0]];
  const bigIds = comps.map((c, i) => [c.area, i]).filter(([a]) => a >= 10000).sort((a, b) => b[0] - a[0]);
  console.log('big components:', bigIds.map(([a, i]) => `#${i}(a=${a},${comps[i].x0}-${comps[i].x1} y${comps[i].y0}-${comps[i].y1})`).join(' '));
  const out = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const id = label[p];
    if (id < 0) continue;
    const bi = bigIds.findIndex(([, i]) => i === id);
    const rgb = bi >= 0 ? palette[bi % palette.length] : [90, 90, 90];
    out[p * ch] = rgb[0]; out[p * ch + 1] = rgb[1]; out[p * ch + 2] = rgb[2]; out[p * ch + 3] = 255;
  }
  await mkdir(TMP_DIR, { recursive: true });
  await sharp(out, { raw: { width: w, height: h, channels: ch } }).png().toFile(fileURLToPath(new URL('../tmp/trace.png', import.meta.url)));
  console.log('wrote tmp/trace.png');
}

const mode = process.argv[2] ?? 'analyze';
if (mode === 'analyze') await analyze();
else if (mode === 'runs') await runs();
else if (mode === 'refine') await refine();
else if (mode === 'probe') await probe();
else if (mode === 'trace') await trace();
else if (mode === 'mark') await mark();
else if (mode === 'cut') await cut();
else throw new Error(`unknown mode: ${mode}`);
