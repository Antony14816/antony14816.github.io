import './style.css';
import type { Offspring, ParentId, ProtopediaWork, Workset } from '../lib/types.ts';
import { newIssueUrl, repoConfigFromEnv } from '../lib/config.ts';
import { slotKey } from '../lib/generation.ts';
import rawOffspring from '../data/offspring.json';
import sampleWorksJson from '../data/protopedia-sample.json';
import rawSampleOffspring from '../data/offspring.sample.json';
import rawWorkset from '../data/prototypes.json';

// ---------------------------------------------------------------------------
// データ読み込み
// ---------------------------------------------------------------------------

const offspring = (rawOffspring as unknown as Offspring[]).slice();
const sampleWorks = (sampleWorksJson as { works: ProtopediaWork[] }).works;
const sampleOffspring = (rawSampleOffspring as unknown as Offspring[]).slice();

// 同期済みのProtoPedia作品（Actionsが scripts/sync-protopedia.ts で更新する）。
// ブラウザからProtoPedia APIは呼ばない（docs/protopediaapi.md §7）。
// 未同期なら開発用サンプルに落とし、[SAMPLE] 表記で本番と区別する。
const workset = rawWorkset as Workset;
const realWorks: ProtopediaWork[] = Array.isArray(workset.works)
  ? workset.works.filter(
      (w): w is ProtopediaWork =>
        !!w && typeof w.id === 'string' && /^protopedia:\d{1,9}$/.test(w.id) && !!w.title,
    )
  : [];
const usingSampleWorks = realWorks.length === 0;
const works: ProtopediaWork[] = usingSampleWorks ? sampleWorks : realWorks;
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

const allNodes: (ProtopediaWork | Offspring)[] = [...works, ...children];
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
    el('p', {}, '2つの発明をスロットに選んで「交配を申請」すると、GitHub Issueが開きます。'),
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

// サンプル表示中かどうか（owner/repo設定とは独立した条件）
if (works.some((w) => w.sample) || children.some((c) => c.sample)) {
  wrap.append(
    el(
      'div',
      { class: 'notice warn window' },
      'ProtoPedia APIは未接続のため、現在は開発用サンプルデータを表示しています（[SAMPLE] 表記・実在の作品ではありません）。',
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

// --- 交配マシン（親選択） ---------------------------------------------------

const pickerSection = el('section', {}, el('h2', {}, '親作品を選ぶ'));

const picker = el('div', { class: 'picker' });

/** 検索クエリに一致するか（名前・概要・作者・タグ / 大文字小文字は無視）。 */
function matchesQuery(w: ProtopediaWork | Offspring, q: string): boolean {
  if (!q) return true;
  const parts = [w.title, w.summary];
  if ('authors' in w && Array.isArray(w.authors)) parts.push(...w.authors);
  if ('tags' in w && Array.isArray(w.tags)) parts.push(...w.tags);
  return parts.join(' ').toLowerCase().includes(q);
}

/** セレクトの選択肢を（検索クエリで絞って）作り直す。 */
function fillParentOptions(sel: HTMLSelectElement, q: string): void {
  const prev = sel.value;
  // 絞り込みに一致しない場合でも、選択中の作品はリストに残す
  // （検索中に選択が黙って解除されるのを防ぐ）。
  const include = (w: ProtopediaWork | Offspring): boolean =>
    matchesQuery(w, q) || w.id === prev;

  sel.replaceChildren(el('option', { value: '' }, '— 選択してください —'));
  const groupProto = el('optgroup', { label: 'ProtoPedia作品（第0世代）' });
  const groupChild = el('optgroup', { label: '生まれた子作品' });
  for (const w of works) {
    if (!include(w)) continue;
    const by = w.authors && w.authors.length > 0 ? ` / ${w.authors[0]}` : '';
    groupProto.append(el('option', { value: w.id }, `${w.title}${by} (${w.id})`));
  }
  for (const c of children) {
    if (!include(c)) continue;
    groupChild.append(
      el('option', { value: c.id }, `第${c.generation}世代 ${c.title} (${c.id})`),
    );
  }
  sel.append(groupProto, groupChild);
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function parentSelect(id: string, labelText: string): HTMLSelectElement {
  const sel = el('select', { id });
  const field = el('div', {}, el('label', { for: id }, labelText), sel);
  picker.append(field);
  fillParentOptions(sel, '');
  return sel;
}

// --- 作品検索（発明図鑑の入口。API同期済み作品が増えてから価値が出る） -------
const filterInput = el('input', {
  id: 'work-filter',
  type: 'search',
  placeholder: '例: 光る地図, 音, Arduino',
}) as HTMLInputElement;
const filterCount = el('span', { class: 'hint' });
const filterField = el(
  'div',
  { class: 'filter' },
  el('label', { for: 'work-filter' }, '作品を検索（名前・作者・タグ・概要）'),
  el('div', { class: 'filter-row' }, filterInput, filterCount),
);

function updateFilterCount(q: string): void {
  const n = [...works, ...children].filter((w) => matchesQuery(w, q)).length;
  filterCount.textContent = q
    ? `${n}件がヒット`
    : `全${works.length + children.length}件から選べます`;
}

const selectA = parentSelect('parent-a', '親作品 A（スロットA）');
const pickerCross = el('div', { class: 'cross' }, '×');
picker.append(pickerCross); // grid順: A / × / B
const selectB = parentSelect('parent-b', '親作品 B（スロットB）');

const actions = el('div', { class: 'actions' });
const breedBtn = el('button', { class: 'breed', type: 'button' }, '交配を申請') as HTMLButtonElement;
const hint = el('span', { class: 'hint' });
actions.append(breedBtn, hint);

const catalogHint = el(
  'div',
  { class: 'hint catalog' },
  usingSampleWorks
    ? `作品一覧は開発用サンプル${works.length}件（ProtoPedia未同期。同期Workflowで置き換わります）`
    : `作品一覧: ProtoPedia ${works.length}件${workset.syncedAt ? `（最終同期: ${workset.syncedAt}）` : ''}`,
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
  catalogHint,
  filterField,
  picker,
  actions,
);
pickerSection.append(machine);
wrap.append(pickerSection);

function currentPair(): [ParentId, ParentId] | null {
  const a = selectA.value;
  const b = selectB.value;
  if (!a || !b || a === b) return null;
  return [a as ParentId, b as ParentId];
}

function refreshBreedButton(): void {
  const pair = currentPair();
  breedBtn.disabled = !pair || !repoCfg;
  if (!pair) {
    hint.textContent = selectA.value && selectA.value === selectB.value
      ? '親Aと親Bは別の作品を選んでください。'
      : '2つの作品を選ぶとGitHub Issueの作成画面が開きます。';
  } else {
    hint.textContent = `${pair[0]} × ${pair[1]} の組み合わせで申請します。`;
  }
}

selectA.addEventListener('change', refreshBreedButton);
selectB.addEventListener('change', refreshBreedButton);

filterInput.addEventListener('input', () => {
  const q = filterInput.value.trim().toLowerCase();
  fillParentOptions(selectA, q);
  fillParentOptions(selectB, q);
  updateFilterCount(q);
  refreshBreedButton();
});
updateFilterCount('');
breedBtn.addEventListener('click', () => {
  const pair = currentPair();
  if (!pair || !repoCfg) return;
  window.open(newIssueUrl(repoCfg, pair[0], pair[1]), '_blank', 'noopener');
});
refreshBreedButton();

// --- 次の交配枠 ------------------------------------------------------------

const slotSection = el('section', {}, el('h2', {}, '交配待ち・次の枠'));
const slotPanel = el('div', { class: 'slot window' });
const nowSlot = slotKey(new Date());
const slotTaken = children.some((c) => c.slot === nowSlot && !c.sample);
slotPanel.append(
  el('div', {}, '現在の時間枠（UTC）: ', el('span', { class: 'value' }, nowSlot)),
  el(
    'div',
    {},
    slotTaken
      ? 'この枠はすでに1件生成済みです。次の枠で処理されます。'
      : 'この枠はまだ空きがあります。',
  ),
  el('div', {}, '1時間に1枠は全ユーザー共有です（ユーザーごとに毎時1回ではありません）。'),
  repoCfg
    ? el(
        'a',
        {
          href: `https://github.com/${repoCfg.owner}/${repoCfg.repo}/issues`,
          target: '_blank',
          rel: 'noopener',
        },
        '交配待ちのIssue一覧 →',
      )
    : el('div', { class: 'empty' }, '交配待ちのIssue一覧はリポジトリ設定後に表示されます。'),
);
slotSection.append(slotPanel);
wrap.append(slotSection);

// --- 最近誕生した発明 -------------------------------------------------------

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
