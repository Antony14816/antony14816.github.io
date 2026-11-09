import './style.css';
import type { Offspring, ParentId, ProtopediaWork } from '../lib/types.ts';
import { newIssueUrl, repoConfigFromEnv } from '../lib/config.ts';
import { CANDIDATES_PER_SLOT, isCandidatesFile, type CandidatesFile } from '../lib/candidates.ts';
import { slotKey } from '../lib/generation.ts';
import rawOffspring from '../data/offspring.json';
import rawCandidates from '../data/current-candidates.json';
import sampleWorksJson from '../data/protopedia-sample.json';
import rawSampleOffspring from '../data/offspring.sample.json';

// ---------------------------------------------------------------------------
// データ読み込み
// ---------------------------------------------------------------------------

const offspring = (rawOffspring as unknown as Offspring[]).slice();
const sampleWorks = (sampleWorksJson as { works: ProtopediaWork[] }).works;
const sampleOffspring = (rawSampleOffspring as unknown as Offspring[]).slice();

// 毎時の交配候補（data/current-candidates.json。Actions「Rotate candidates」が毎時更新）。
// ブラウザからProtoPedia APIは呼ばない。ページ再読み込みで候補は変わらない。
// 形が想定外なら開発用サンプルに落とし、[SAMPLE] 表記で本番と明確に区別する。
const candidatesFile: CandidatesFile | null = isCandidatesFile(rawCandidates)
  ? rawCandidates
  : null;
const usingSampleCandidates = candidatesFile === null;
const candidates: ProtopediaWork[] = usingSampleCandidates
  ? sampleWorks
  : candidatesFile.candidates;

// 本番データが0件の間はサンプル子作品も表示する（家系図が空にならないように。
// 各データは sample フラグ・[SAMPLE]表記つきで本番と明確に区別される）。
const showSampleOffspring = offspring.length === 0;
const children: Offspring[] = showSampleOffspring ? sampleOffspring : offspring;

const repoCfg = repoConfigFromEnv({
  VITE_GITHUB_OWNER: import.meta.env.VITE_GITHUB_OWNER,
  VITE_GITHUB_REPO: import.meta.env.VITE_GITHUB_REPO,
  GITHUB_REPOSITORY: typeof __GITHUB_REPOSITORY__ !== 'undefined' ? __GITHUB_REPOSITORY__ : '',
});

// ---------------------------------------------------------------------------
// ヘルパー（安全なDOM構築: 外部入力はHTMLとして挿入しない）
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'href') node.setAttribute('href', v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

// 家系図の完整性: サンプル子作品の親作品が候補カードに入っていない場合も、
// 系譜として描けるよう参照だけ追加する（候補カードには表示しない）。
const candidateIds = new Set(candidates.map((c) => c.id));
const supportWorks = sampleWorks.filter((w) => !candidateIds.has(w.id));
const allNodes: (ProtopediaWork | Offspring)[] = [...candidates, ...supportWorks, ...children];
const nodeById = new Map<string, ProtopediaWork | Offspring>(allNodes.map((n) => [n.id, n]));

function isOffspring(n: ProtopediaWork | Offspring | undefined): n is Offspring {
  return !!n && 'sourceIssue' in n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 親×親 → 子 を表すピクセルの交差ロゴ（色はテーマCSSに追従）。 */
function logoSprite(): SVGSVGElement {
  const cells: [number, number, string][] = [];
  const size = 16;
  for (let i = 0; i < 8; i++) {
    const c = i * 2;
    cells.push([c, c, i === 4 ? 'm0' : 'm2']); // \ 系
    cells.push([size - 2 - c, c, i === 4 ? 'm0' : 'm1']); // / 系
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'logo');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mashup Ours ロゴ');
  for (const [x, y, cls] of cells) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', '2');
    rect.setAttribute('height', '2');
    rect.setAttribute('class', cls);
    svg.append(rect);
  }
  return svg;
}

function label(n: ProtopediaWork | Offspring | undefined): string {
  return n ? n.title : '(不明)';
}

// ---------------------------------------------------------------------------
// テーマ切替（ダーク / ライト）
// ---------------------------------------------------------------------------

const THEME_KEY = 'mashup-theme';

type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  const mq = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
  return mq ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>('#app')!;
const wrap = el('div', { class: 'wrap' });
app.append(wrap);

const themeBtn = el('button', { class: 'theme-toggle', type: 'button' }) as HTMLButtonElement;

function updateThemeBtn(): void {
  const t = currentTheme();
  themeBtn.textContent = t === 'dark' ? 'ライトにする' : 'ダークにする';
  themeBtn.setAttribute('aria-label', `表示テーマを切り替える（現在: ${t === 'dark' ? 'ダーク' : 'ライト'}）`);
}

themeBtn.addEventListener('click', () => {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* プライベートモード等では保存できないが表示は切り替わる */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#202735' : '#FFF5DE');
  updateThemeBtn();
});

const heroLeft = el(
  'div',
  {},
  el('p', { class: 'eyebrow' }, '— 16bit 交配研究所 —'),
  el('div', { class: 'hero-title-row' }, logoSprite(), el('h1', {}, 'Mashup Ours')),
  el('p', { class: 'copy' }, '20年分の発明を、もう一度マッシュアップ。'),
);

wrap.append(
  el('header', { class: 'hero' }, el('div', { class: 'hero-top' }, heroLeft, themeBtn)),
);
updateThemeBtn();

// --- 所長のメモ（セリフウィンドウ。キャラ画はMVP後に追加 / DESIGN.md §4） ---

wrap.append(
  el(
    'div',
    { class: 'memo window' },
    el('div', { class: 'titlebar' }, el('span', {}, '所長のメモ')),
    el('p', {}, '今時間の候補から2つ選んで「交配を申請」すると、GitHub Issueが開きます。'),
    el('p', {}, '生成は1時間に1枠。すべてAIが考えた未実装のアイデアです。'),
  ),
);

// 注意書き
wrap.append(
  el(
    'div',
    { class: 'notice window' },
    '生成された子作品は ',
    el('strong', {}, 'AIが考えた未実装の発明アイデア'),
    ' です。実際に製作したもの・実在の成果物ではありません。 ProtoPediaの元作品は出典リンク先を参照してください。',
  ),
);

// サンプル表示中かどうか（owner/repo設定とは独立した条件）。
// 候補と子作品は別々に未同期になり得るので、表示場所ごとに正しく案内する。
if (candidates.some((w) => w.sample)) {
  wrap.append(
    el(
      'div',
      { class: 'notice warn window' },
      'ProtoPediaの候補データが未同期のため、候補は開発用サンプルです（[SAMPLE] 表記・実在の作品ではありません）。',
    ),
  );
}
if (children.some((c) => c.sample)) {
  wrap.append(
    el(
      'div',
      { class: 'notice warn window' },
      '子作品がまだ0件のため、「最近誕生した発明」と「家系図」には開発用サンプルを表示しています（[SAMPLE] 表記・実在の生成結果ではありません）。',
    ),
  );
}

if (!repoCfg) {
  wrap.append(
    el(
      'div',
      { class: 'notice error window' },
      'GitHub owner/repo が未設定です。.env.example を .env にコピーして VITE_GITHUB_OWNER / VITE_GITHUB_REPO を設定してください（交配申請リンクは設定後に有効になります）。Actions では GITHUB_REPOSITORY から自動設定されます。',
    ),
  );
}

// ---------------------------------------------------------------------------
// ① 今時間の交配候補（毎時6件・全ユーザー共通。追加開発指示 §2/§3）
// ---------------------------------------------------------------------------

// 完成イメージ（tmp/CleanShot 2026-11-09 at 21.43.19.png）準拠:
// パネル見出し「本日の発明研究所」+ ラテン小見出し + 右上バッジ。
// その下に画像中心の3列カード（画像タイルが主役、キャプションは下に添える）。
const candSection = el('section', { class: 'cand-section' });
const stateBadge = el('span', { class: 'chip' });
const candMeta = el('div', { class: 'cand-meta' });
const grid = el('div', { class: 'candidates' });

/** slot "YYYY-MM-DDTHH"（UTC）を日本時間の表示に変換する。 */
function fmtJst(slot: string): string {
  const ms = Date.parse(`${slot}:00:00Z`);
  if (Number.isNaN(ms)) return slot;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

if (candidatesFile) {
  const f = candidatesFile;
  candMeta.append(
    el(
      'div',
      {},
      '候補スロット: ',
      el('span', { class: 'value' }, f.slot),
      '（UTC。右上のバッジと同じ枠に切り替わります）',
    ),
    el('div', {}, '候補生成: ', el('span', { class: 'value' }, f.generatedAt), '（Actionsの実行結果）'),
    el(
      'div',
      {},
      '次回の候補更新予定: ',
      el('span', { class: 'value' }, `${f.nextSlot}:00 UTC`),
      `（日本時間 ${fmtJst(f.nextSlot)} 頃・毎時更新）`,
    ),
  );
  // Actionsの実行遅延はJSONの値（実行結果）ベースで表現する（端末時計で補完しない）
  const nextMs = Date.parse(`${f.nextSlot}:00:00Z`);
  if (Number.isFinite(nextMs) && Date.now() > nextMs) {
    candMeta.append(
      el('div', { class: 'stale' }, '⚠ 候補更新が遅れています（Actionsの実行完了後に切り替わります）。'),
    );
  }
  if (f.candidates.length < CANDIDATES_PER_SLOT) {
    candMeta.append(
      el('div', { class: 'hint' }, `現在の候補は${f.candidates.length}件です（最大${CANDIDATES_PER_SLOT}件）。`),
    );
  }
} else {
  candMeta.append(
    el('div', { class: 'hint' }, `候補データ未同期: 開発用サンプル${candidates.length}件を表示中です。`),
  );
}
candMeta.append(
  el('div', { class: 'hint' }, '候補は1時間ごとに差し替わります。ページを再読み込みしても候補は変わりません。'),
);
// 右上バッジ: サンプル表示中か本番候補かを常に見せる
stateBadge.textContent = usingSampleCandidates
  ? '開発用サンプル'
  : `毎時${CANDIDATES_PER_SLOT}件・全ユーザー共通`;
if (usingSampleCandidates) stateBadge.classList.add('chip-warn');

// --- 選択状態（親A / 親B） -------------------------------------------------

let pickA: string | null = null;
let pickB: string | null = null;

interface PickControls {
  /** 状態クラス（is-a / is-b）を付ける要素（候補カード or 子作品の行） */
  host: HTMLElement;
  /** 「親A選択中」バッジ（候補カードのみ。子作品の行には無し） */
  badge: HTMLElement | null;
  a: HTMLButtonElement;
  b: HTMLButtonElement;
}

const pickRegistry = new Map<string, PickControls>();

function pickButton(slot: 'a' | 'b', id: string, stopBubble: boolean): HTMLButtonElement {
  const btn = el(
    'button',
    {
      class: 'pick',
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': `${slot === 'a' ? '親A' : '親B'}にする: ${label(nodeById.get(id))}`,
    },
    slot === 'a' ? 'Aにする' : 'Bにする',
  ) as HTMLButtonElement;
  btn.addEventListener('click', (e) => {
    if (stopBubble) e.stopPropagation(); // 子作品の行クリック（詳細表示）と競合させない
    togglePick(slot, id);
  });
  return btn;
}

function togglePick(slot: 'a' | 'b', id: string): void {
  if (slot === 'a') {
    pickA = pickA === id ? null : id;
    if (pickA && pickB === id) pickB = null; // 同じ作品をAとBに同時に指定しない
  } else {
    pickB = pickB === id ? null : id;
    if (pickB && pickA === id) pickA = null;
  }
  updateSelectionUI();
}

/** 作品カードのサムネイル枠。画像が無く・届かなくても枠は維持する（レイアウト崩れ防止）。 */
function thumbNode(w: ProtopediaWork): HTMLElement {
  const box = el('div', { class: 'thumb' });
  const placeholder = () => box.replaceChildren(el('div', { class: 'thumb-ph' }, '画像なし'));
  if (!w.mainUrl) {
    placeholder();
    return box;
  }
  const img = el('img', {
    src: w.mainUrl,
    alt: `${w.title}の作品画像（ProtoPedia）`,
    loading: 'lazy',
  }) as HTMLImageElement;
  img.addEventListener('error', () => {
    img.remove();
    placeholder();
  });
  box.append(img);
  return box;
}

function buildCandidateCard(w: ProtopediaWork, index: number): HTMLElement {
  const card = el('article', { class: 'candidate', 'data-id': w.id });
  card.append(thumbNode(w));

  const badge = el('span', { class: 'badge pick-state' }, '');
  badge.hidden = true; // 選択中のみ表示（色だけに依存せずテキストで状態を示す）

  const idx = el('div', { class: 'card-index' }, `作品 No.${String(index + 1).padStart(2, '0')}`);
  const h3 = el('h3', {}, w.title, badge);
  const author = el(
    'div',
    { class: 'author' },
    w.authors && w.authors.length > 0 ? `作者: ${w.authors.join(' / ')}` : '作者: （不明）',
  );
  const summary = el('p', { class: 'summary' }, w.summary || '（概要なし）');
  const link = el('a', { href: w.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'ProtoPediaで見る ↗');

  const btnA = pickButton('a', w.id, false);
  const btnB = pickButton('b', w.id, false);
  const picks = el('div', { class: 'picks' }, btnA, btnB);
  const foot = el('div', { class: 'card-foot' }, link, picks);

  const body = el('div', { class: 'card-body' }, idx, h3, author, summary, foot);
  card.append(body);

  pickRegistry.set(w.id, { host: card, badge, a: btnA, b: btnB });
  return card;
}

candidates.forEach((w, i) => grid.append(buildCandidateCard(w, i)));
if (candidates.length === 0) {
  grid.append(el('div', { class: 'empty' }, '候補がありません（データ未同期です）。'));
}
candSection.append(
  el(
    'div',
    { class: 'lab-panel' },
    el(
      'div',
      { class: 'lab-head' },
      el(
        'div',
        { class: 'lab-titles' },
        el('h2', {}, '本日の発明研究所'),
        el('p', { class: 'lab-sub' }, 'LAB / INVENTION CANDIDATES'),
      ),
      stateBadge,
    ),
    candMeta,
    grid,
  ),
);
wrap.append(candSection);

// ---------------------------------------------------------------------------
// ② 交配マシン（選択状態・申請・稼働状況・交配待ち）
// ---------------------------------------------------------------------------

const machineSection = el('section', {}, el('h2', {}, '交配マシン'));

const statusA = el('span', { class: 'status-val empty' }, '（未選択）');
const statusB = el('span', { class: 'status-val empty' }, '（未選択）');
const statusRow = el(
  'div',
  { class: 'status-row' },
  el('div', { class: 'side' }, el('span', { class: 'side-label' }, '親A'), statusA),
  el('span', { class: 'cross', 'aria-hidden': 'true' }, '×'),
  el('div', { class: 'side' }, el('span', { class: 'side-label' }, '親B'), statusB),
);

// 稼働状況と交配待ち（DESIGN.md §1: ファーストビュー圏で分かるように）
const nowSlot = slotKey(new Date());
const slotTaken = children.some((c) => c.slot === nowSlot && !c.sample);
const statusNote = el(
  'div',
  { class: 'slot' },
  el(
    'div',
    {},
    '現在の交配枠（UTC）: ',
    el('span', { class: 'value' }, nowSlot),
    slotTaken ? ' — この枠はすでに1件生成済みです。' : ' — この枠はまだ空きがあります。',
  ),
  el('div', {}, '1時間に1枠は全ユーザー共有です（ユーザーごとに毎時1回ではありません）。'),
  repoCfg
    ? el(
        'div',
        {},
        '交配申請中の組み合わせは公開Issueで確認できます: ',
        el(
          'a',
          {
            href: `https://github.com/${repoCfg.owner}/${repoCfg.repo}/issues?q=is%3Aissue+state%3Aopen`,
            target: '_blank',
            rel: 'noopener',
          },
          '交配待ちのIssue一覧 →',
        ),
      )
    : el('div', { class: 'empty' }, '交配待ちのIssue一覧はリポジトリ設定後に表示されます。'),
);

const breedBtn = el('button', { class: 'breed', type: 'button' }, '交配を申請') as HTMLButtonElement;
const hint = el('span', { class: 'hint' });
const actions = el('div', { class: 'actions' }, breedBtn, hint);

const machineHint = el(
  'div',
  { class: 'hint catalog' },
  usingSampleCandidates
    ? '候補は開発用サンプルです（実在の作品ではありません）。'
    : '候補カードの「Aにする」「Bにする」で2つ選んで申請できます。',
);

const machine = el(
  'div',
  { class: 'machine window' },
  el(
    'div',
    { class: 'titlebar' },
    el('span', {}, '交配マシン'),
    el(
      'span',
      { class: 'lamps', 'aria-hidden': 'true' },
      el('span', { class: 'lamp mint' }),
      el('span', { class: 'lamp yellow' }),
      el('span', { class: 'lamp coral' }),
    ),
  ),
  machineHint,
  statusRow,
  statusNote,
  actions,
);
machineSection.append(machine);
wrap.append(machineSection);

function pickText(id: string | null): string {
  if (!id) return '（未選択）';
  const n = nodeById.get(id);
  return n ? `${n.title} (${id})` : id;
}

function currentPair(): [ParentId, ParentId] | null {
  if (!pickA || !pickB || pickA === pickB) return null;
  return [pickA as ParentId, pickB as ParentId];
}

function refreshBreedButton(): void {
  const pair = currentPair();
  breedBtn.disabled = !pair || !repoCfg;
  if (!pair) {
    hint.textContent =
      pickA && pickB && pickA === pickB
        ? '親Aと親Bは別の作品を選んでください。'
        : '候補カードから2つ選ぶとGitHub Issueの作成画面が開きます。';
  } else if (!repoCfg) {
    hint.textContent = 'owner/repo未設定のため申請できません（上の案内を参照）。';
  } else {
    hint.textContent = `${pair[0]} × ${pair[1]}${
      candidatesFile ? `（候補スロット ${candidatesFile.slot}）` : ''
    } の組み合わせで申請します。`;
  }
}

function updateSelectionUI(): void {
  for (const [id, c] of pickRegistry) {
    const isA = pickA === id;
    const isB = pickB === id;
    c.host.classList.toggle('is-a', isA);
    c.host.classList.toggle('is-b', isB);
    c.a.setAttribute('aria-pressed', String(isA));
    c.b.setAttribute('aria-pressed', String(isB));
    if (c.badge) {
      c.badge.hidden = !(isA || isB);
      c.badge.textContent = isA ? '親A選択中' : isB ? '親B選択中' : '';
    }
  }
  statusA.textContent = pickText(pickA);
  statusA.classList.toggle('empty', !pickA);
  statusB.textContent = pickText(pickB);
  statusB.classList.toggle('empty', !pickB);
  refreshBreedButton();
}

breedBtn.addEventListener('click', () => {
  const pair = currentPair();
  if (!pair || !repoCfg) return;
  const wa = nodeById.get(pair[0]);
  const wb = nodeById.get(pair[1]);
  window.open(
    newIssueUrl(repoCfg, pair[0], pair[1], {
      slot: candidatesFile?.slot,
      parentAUrl: wa && !isOffspring(wa) ? wa.sourceUrl : undefined,
      parentBUrl: wb && !isOffspring(wb) ? wb.sourceUrl : undefined,
    }),
    '_blank',
    'noopener',
  );
});

// ---------------------------------------------------------------------------
// ③ 最近誕生した発明（直近の交配結果）
// ---------------------------------------------------------------------------

const listSection = el('section', {}, el('h2', {}, '最近誕生した発明'));
const list = el('ul', { class: 'offspring' });
const sorted = [...children].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
if (sorted.length === 0) {
  list.append(el('li', { class: 'empty' }, 'まだ子作品は生まれていません。'));
} else {
  for (const c of sorted) {
    const li = el(
      'li',
      {},
      el(
        'div',
        { class: 'title' },
        c.title,
        el('span', { class: 'badge idea' }, '未実装のアイデア'),
        c.sample ? el('span', { class: 'badge sample' }, 'SAMPLE') : '',
      ),
      el('div', { class: 'hint' }, c.summary),
      el(
        'div',
        { class: 'hint' },
        `${c.id} ・ 第${c.generation}世代 ・ ${c.parents[0]} × ${c.parents[1]}`,
      ),
    );
    li.addEventListener('click', () => selectNode(c.id));
    // 子作品も親にできる（AGENTS.md の完成形）。カードと同じ A/B 操作で選択できる。
    const btnA = pickButton('a', c.id, true);
    const btnB = pickButton('b', c.id, true);
    li.append(el('div', { class: 'li-picks' }, btnA, btnB));
    pickRegistry.set(c.id, { host: li, badge: null, a: btnA, b: btnB });
    list.append(li);
  }
}
listSection.append(list);
wrap.append(listSection);

// --- 家系図 -----------------------------------------------------------------

const pedSection = el('section', {}, el('h2', {}, '家系図'));
// 色だけに依存させない: 凡例 + 破線/実線の形アクセントで区別する
const legend = el(
  'div',
  { class: 'pedigree-legend' },
  el('span', { class: 'key' }, el('span', { class: 'swatch proto' }), 'ProtoPediaの元作品（実線・第0世代）'),
  el('span', { class: 'key' }, el('span', { class: 'swatch child' }), 'AIが生んだ子作品（破線・未実装アイデア）'),
  el('span', { class: 'scroll-hint' }, '横スクロールで系譜をたどれます'),
);
const pedScroll = el('div', { class: 'pedigree-scroll window' });
const detailBox = el('div', { class: 'detail window' }, el('p', { class: 'empty' }, 'ノードをクリックすると詳細を表示します。'));
pedSection.append(legend, pedScroll, detailBox);
wrap.append(pedSection);

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  gen: number;
}

const NODE_W = 240;
const NODE_H = 44;
const COL_W = 300;
const NODE_FONT = 13;

/** フォント幅の概算（本文 = Noto Sans JP想定: 全角 ≈ fontSize、半角 ≈ 0.6 × fontSize）。 */
function estTextWidth(s: string, fontSize = NODE_FONT): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) < 0x80 ? fontSize * 0.6 : fontSize;
  return w;
}

/** ノード枠に収まるよう文字単位で切り詰める（固定文字数ではなく幅で判定）。 */
function truncateToWidth(s: string, maxWidth: number, fontSize = NODE_FONT): string {
  if (estTextWidth(s, fontSize) <= maxWidth) return s;
  let out = '';
  for (const ch of s) {
    if (estTextWidth(out + ch + '…', fontSize) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}
const ROW_H = 76;

const edges: [string, string][] = [];
for (const c of children) {
  for (const p of c.parents) edges.push([p, c.id]);
}

const involved = new Set<string>();
for (const [p, c] of edges) {
  involved.add(p);
  involved.add(c);
}
// 子がいない場合も第0世代の作品は見えるようにする
const visibleNodes = involved.size > 0
  ? allNodes.filter((n) => involved.has(n.id))
  : allNodes;

const byGen = new Map<number, (ProtopediaWork | Offspring)[]>();
for (const n of visibleNodes) {
  const g = isOffspring(n) ? n.generation : 0;
  const arr = byGen.get(g) ?? [];
  arr.push(n);
  byGen.set(g, arr);
}

const layout = new Map<string, LayoutNode>();
let maxY = 0;
for (const [gen, nodes] of [...byGen.entries()].sort((a, b) => a[0] - b[0])) {
  nodes.forEach((n, i) => {
    layout.set(n.id, { id: n.id, x: 30 + gen * COL_W, y: 30 + i * ROW_H, gen });
    maxY = Math.max(maxY, 30 + i * ROW_H);
  });
}

const svgW = 30 + (Math.max(0, ...[...layout.values()].map((n) => n.gen)) + 1) * COL_W;
const svgH = maxY + NODE_H + 40;

function renderPedigree(): void {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  for (const [p, c] of edges) {
    const from = layout.get(p);
    const to = layout.get(c);
    if (!from || !to) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    path.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('class', 'edge');
    svg.append(path);
  }

  for (const n of layout.values()) {
    const node = nodeById.get(n.id);
    if (!node) continue;
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `node ${isOffspring(node) ? 'child' : 'proto'}`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${node.title}（${n.id}）`);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(n.x));
    rect.setAttribute('y', String(n.y));
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    const hoverTitle = document.createElementNS(SVG_NS, 'title');
    hoverTitle.textContent = `${node.title} — ${node.summary}`;
    const text = document.createElementNS(SVG_NS, 'text');
    const title = truncateToWidth(node.title, NODE_W - 24);
    text.setAttribute('x', String(n.x + 12));
    text.setAttribute('y', String(n.y + NODE_H / 2 + 4));
    text.textContent = title;
    g.append(rect, hoverTitle, text);
    g.addEventListener('click', () => selectNode(n.id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectNode(n.id);
      }
    });
    svg.append(g);
  }

  pedScroll.replaceChildren(svg);
}

function renderDetail(id: string): void {
  const node = nodeById.get(id);
  if (!node) return;
  const dl = el('dl', {});
  const add = (term: string, value: Node | string) => {
    dl.append(el('dt', {}, term), el('dd', {}, value));
  };

  const badges = el('div', {});
  if (isOffspring(node)) {
    badges.append(el('span', { class: 'badge idea' }, 'AIが考えた未実装の発明アイデア'));
    if (node.sample) badges.append(el('span', { class: 'badge sample' }, 'SAMPLE'));
  } else if (node.sample) {
    badges.append(el('span', { class: 'badge sample' }, '開発用サンプル'));
  }

  add('概要', node.summary);

  if (isOffspring(node)) {
    add('コンセプト', node.concept);
    add('仕組み', node.mechanism);
    const traits = el('ul', {});
    for (const t of node.inheritedTraits) {
      traits.append(el('li', {}, `${label(nodeById.get(t.parentId))} から「${t.trait}」を継承`));
    }
    add('継承した特徴', traits);
    const parentsList = el('ul', {});
    for (const p of node.parents) {
      const li = el('li', {});
      const btn = el('button', { class: 'linkish', type: 'button' }, label(nodeById.get(p)));
      btn.addEventListener('click', () => selectNode(p));
      li.append(btn, ` (${p})`);
      parentsList.append(li);
    }
    add('親', parentsList);
    const kids = children.filter((c) => c.parents.includes(node.id as ParentId));
    add(
      '子',
      kids.length > 0
        ? kids.map((k) => k.title).join(' / ')
        : '（まだいません）',
    );
    if (node.sample) {
      add('出典', '開発用サンプルデータ（実在の生成結果ではありません）');
    } else if (repoCfg && node.sourceIssue > 0) {
      add(
        '生成Issue',
        el(
          'a',
          {
            href: `https://github.com/${repoCfg.owner}/${repoCfg.repo}/issues/${node.sourceIssue}`,
            target: '_blank',
            rel: 'noopener',
          },
          `Issue #${node.sourceIssue}`,
        ),
      );
    }
    add('生成日時', `${node.createdAt} ・ モデル: ${node.model}`);
  } else {
    add('世代', '第0世代（ProtoPediaの元作品）');
    if (node.authors && node.authors.length > 0) add('作者', node.authors.join(' / '));
    if (node.tags && node.tags.length > 0) add('タグ', node.tags.join(' / '));
    if (node.licenseType) add('ライセンス', node.licenseType);
    if (node.mainUrl) {
      const img = el('img', {
        src: node.mainUrl,
        alt: `${node.title}の作品画像（ProtoPedia）`,
        loading: 'lazy',
      });
      // 画像が届かない場合は枠だけで壊れないように取り除く
      img.addEventListener('error', () => img.remove());
      add('作品画像', img);
    }
    add('出典', el('a', { href: node.sourceUrl, target: '_blank', rel: 'noopener' }, node.sourceUrl));
    if (node.sample) {
      add('注意', '開発用の架空サンプル作品です。実在のProtoPedia作品ではありません。');
    }
  }

  detailBox.replaceChildren(el('h3', {}, node.title), badges, dl);
}

function selectNode(id: string): void {
  renderDetail(id);
  detailBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

renderPedigree();
updateSelectionUI();
