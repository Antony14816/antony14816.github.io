import './style.css';
import type { Offspring, ParentId, ProtopediaWork } from '../lib/types.ts';
import { newIssueUrl, repoConfigFromEnv } from '../lib/config.ts';
import { slotKey } from '../lib/generation.ts';
import rawOffspring from '../data/offspring.json';
import sampleWorksJson from '../data/protopedia-sample.json';
import rawSampleOffspring from '../data/offspring.sample.json';

// ---------------------------------------------------------------------------
// データ読み込み
// ---------------------------------------------------------------------------

const offspring = (rawOffspring as unknown as Offspring[]).slice();
const sampleWorks = (sampleWorksJson as { works: ProtopediaWork[] }).works;
const sampleOffspring = (rawSampleOffspring as unknown as Offspring[]).slice();

// ProtoPedia API未接続のため、現時点では開発用サンプル作品のみを表示する。
const works: ProtopediaWork[] = sampleWorks;
const showSampleOffspring = offspring.length === 0 && import.meta.env.DEV;
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

function label(n: ProtopediaWork | Offspring | undefined): string {
  return n ? n.title : '(不明)';
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>('#app')!;
const wrap = el('div', { class: 'wrap' });
app.append(wrap);

wrap.append(
  el(
    'header',
    { class: 'hero' },
    el('h1', {}, 'Mashup Ours'),
    el('p', { class: 'copy' }, '20年分の発明を、もう一度マッシュアップ。'),
  ),
);

// 注意書き
wrap.append(
  el(
    'div',
    { class: 'notice' },
    '生成された子作品は ',
    el('strong', {}, 'AIが考えた未実装の発明アイデア'),
    ' です。実際に製作したもの・実在の成果物ではありません。 ProtoPediaの元作品は出典リンク先を参照してください。',
  ),
);

if (!repoCfg) {
  wrap.append(
    el(
      'div',
      { class: 'notice error' },
      'GitHub owner/repo が未設定です。.env.example を .env にコピーして VITE_GITHUB_OWNER / VITE_GITHUB_REPO を設定してください（交配申請リンクは設定後に有効になります）。',
    ),
  );
} else {
  wrap.append(
    el(
      'div',
      { class: 'notice warn' },
      'ProtoPedia APIは未接続のため、現在は開発用サンプル作品を表示しています（[SAMPLE] 表記）。',
    ),
  );
}

// --- 親選択 ---------------------------------------------------------------

const pickerSection = el('section', {}, el('h2', {}, '親を選ぶ'));
const picker = el('div', { class: 'picker panel' });

function parentSelect(id: string, labelText: string): HTMLSelectElement {
  const sel = el('select', { id });
  sel.append(el('option', { value: '' }, '— 選択してください —'));
  const groupProto = el('optgroup', { label: 'ProtoPedia作品（第0世代）' });
  const groupChild = el('optgroup', { label: '生まれた子作品' });
  for (const w of works) {
    groupProto.append(el('option', { value: w.id }, `${w.title} (${w.id})`));
  }
  for (const c of children) {
    groupChild.append(
      el('option', { value: c.id }, `第${c.generation}世代 ${c.title} (${c.id})`),
    );
  }
  sel.append(groupProto, groupChild);
  const field = el('div', {}, el('label', { for: id }, labelText), sel);
  picker.append(field);
  return sel;
}

const selectA = parentSelect('parent-a', '親A');
const pickerCross = el('div', { class: 'cross' }, '×');
picker.append(pickerCross); // grid順: A / × / B
const selectB = parentSelect('parent-b', '親B');

const actions = el('div', { class: 'actions' });
const breedBtn = el('button', { class: 'breed', type: 'button' }, '交配申請する（GitHub Issue）') as HTMLButtonElement;
const hint = el('span', { class: 'hint' });
actions.append(breedBtn, hint);
picker.append(actions);
pickerSection.append(picker);
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
breedBtn.addEventListener('click', () => {
  const pair = currentPair();
  if (!pair || !repoCfg) return;
  window.open(newIssueUrl(repoCfg, pair[0], pair[1]), '_blank', 'noopener');
});
refreshBreedButton();

// --- 次の交配枠 ------------------------------------------------------------

const slotSection = el('section', {}, el('h2', {}, '交配待ち・次の枠'));
const slotPanel = el('div', { class: 'panel slot' });
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
        'div',
        {},
        el(
          'a',
          {
            href: `https://github.com/${repoCfg.owner}/${repoCfg.repo}/issues`,
            target: '_blank',
            rel: 'noopener',
          },
          '交配待ちのIssue一覧 →',
        ),
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
const pedScroll = el('div', { class: 'pedigree-scroll' });
const detailBox = el('div', { class: 'detail' }, el('p', { class: 'empty' }, 'ノードをクリックすると詳細を表示します。'));
pedSection.append(pedScroll, detailBox);
wrap.append(pedSection);

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  gen: number;
}

const NODE_W = 210;
const NODE_H = 44;
const COL_W = 270;
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
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  for (const [p, c] of edges) {
    const from = layout.get(p);
    const to = layout.get(c);
    if (!from || !to) continue;
    const path = document.createElementNS(svgNS, 'path');
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
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `node ${isOffspring(node) ? 'child' : 'proto'}`);
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(n.x));
    rect.setAttribute('y', String(n.y));
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '8');
    const text = document.createElementNS(svgNS, 'text');
    const title = node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title;
    text.setAttribute('x', String(n.x + 12));
    text.setAttribute('y', String(n.y + NODE_H / 2 + 4));
    text.textContent = title;
    g.append(rect, text);
    g.addEventListener('click', () => selectNode(n.id));
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
    badges.append(el('span', { class: 'badge sample' }, '開発用サンプル' ));
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
