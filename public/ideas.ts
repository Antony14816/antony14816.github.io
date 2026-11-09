import './style.css';
import type { Offspring, ParentId, ProtopediaWork } from '../lib/types.ts';
import { repoConfigFromEnv } from '../lib/config.ts';
import { isCandidatesFile } from '../lib/candidates.ts';
import rawOffspring from '../data/offspring.json';
import rawCandidates from '../data/current-candidates.json';
import sampleWorksJson from '../data/protopedia-sample.json';

/**
 * /ideas — 生み出されたアイデア一覧（issue #8）。
 * トップ（src/main.ts）と同じデータソースから子作品を列挙する。
 * 外部入力はHTMLとして挿入せず、必ずテキストノード経由で描画する（XSS対策）。
 * URLは GitHub Pages の base パス（import.meta.env.BASE_URL）前提のリンクで組み、
 * リポジトリ名はハードコードしない。
 */

const offspring = (rawOffspring as unknown as Offspring[]).slice();
const sampleWorks = (sampleWorksJson as { works: ProtopediaWork[] }).works;
const candWorks = isCandidatesFile(rawCandidates) ? rawCandidates.candidates : [];

const repoCfg = repoConfigFromEnv({
  VITE_GITHUB_OWNER: import.meta.env.VITE_GITHUB_OWNER,
  VITE_GITHUB_REPO: import.meta.env.VITE_GITHUB_REPO,
  GITHUB_REPOSITORY: typeof __GITHUB_REPOSITORY__ !== 'undefined' ? __GITHUB_REPOSITORY__ : '',
});

const THEME_KEY = 'mashup-theme';
type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark' || t === 'light') return t;
  const mq =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  return mq ? 'dark' : 'light';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** ISO日時を日本時間表示に（JST明記でタイムゾーンの誤解を防ぐ）。 */
function fmtDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const s = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
  return `${s} JST`;
}

export interface IdeasContext {
  /** Issueリンク用。未設定なら元Issueのリンクは出さない（トップと同じ）。 */
  repoCfg: { owner: string; repo: string } | null;
  /** サイトルートへの基点（'/' や '/<repo>/'、相対base時は '../'）。 */
  base: string;
}

/** 親の表示。ProtoPediaは出典URLへ、子作品はトップの詳細（?id=）へ戻す。 */
function parentRef(
  id: ParentId,
  base: string,
  titleOf: Map<string, string>,
): { text: string; href: string; external: boolean } {
  const text = titleOf.get(id) ?? id;
  if (id.startsWith('protopedia:')) {
    // URLはIDから導出する（https固定）。データ中の文字列をURLとして信用しない。
    return {
      text,
      href: `https://protopedia.net/prototype/${id.slice('protopedia:'.length)}`,
      external: true,
    };
  }
  return { text, href: `${base}?id=${encodeURIComponent(id)}`, external: false };
}

function buildIdeaItem(
  c: Offspring,
  ctx: IdeasContext,
  titleOf: Map<string, string>,
): HTMLElement {
  const li = el('li', { class: 'idea-item', 'data-id': c.id });

  const badges = el('div', { class: 'idea-badges' }, el('span', { class: 'badge idea' }, '未実装のアイデア'));
  badges.append(el('span', { class: 'badge gen' }, `第${c.generation}世代`));
  if (c.sample) badges.append(el('span', { class: 'badge sample' }, 'SAMPLE'));

  const pa = parentRef(c.parents[0], ctx.base, titleOf);
  const pb = parentRef(c.parents[1], ctx.base, titleOf);
  const parentLink = (r: ReturnType<typeof parentRef>): HTMLElement => {
    const a = el('a', { href: r.href }, r.text);
    if (r.external) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    return a;
  };

  const meta = el(
    'div',
    { class: 'idea-meta hint' },
    `${c.id} ・ 生成: ${fmtDate(c.createdAt)}`,
  );

  const foot = el('div', { class: 'idea-foot' });
  foot.append(
    el(
      'a',
      { class: 'idea-detail', href: `${ctx.base}?id=${encodeURIComponent(c.id)}` },
      '家系図で詳細を見る →',
    ),
  );
  if (ctx.repoCfg && c.sourceIssue > 0) {
    foot.append(
      el(
        'a',
        {
          href: `https://github.com/${ctx.repoCfg.owner}/${ctx.repoCfg.repo}/issues/${c.sourceIssue}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        `生成Issue #${c.sourceIssue} ↗`,
      ),
    );
  }

  li.append(
    badges,
    el('h3', { class: 'idea-title' }, c.title),
    el('p', { class: 'idea-summary' }, c.summary || '（概要なし）'),
    el(
      'div',
      { class: 'idea-parents' },
      el('span', { class: 'lbl' }, '親: '),
      parentLink(pa),
      el('span', { class: 'cross' }, ' × '),
      parentLink(pb),
    ),
    meta,
    foot,
  );
  return li;
}

/** /ideas ページ本体を host に構築する（テストから直接呼けるよう純関数寄りに）。 */
export function buildIdeasPage(
  host: HTMLElement,
  list: Offspring[],
  ctx: IdeasContext,
): void {
  host.replaceChildren();

  // ID → タイトル（表示する一覧 + 読み込み済みの元作品）。無いIDはIDのまま表示する。
  const titleOf = new Map<string, string>();
  for (const w of sampleWorks) titleOf.set(w.id, w.title);
  for (const w of candWorks) titleOf.set(w.id, w.title);
  for (const c of list) titleOf.set(c.id, c.title);

  const wrap = el('div', { class: 'wrap' });
  host.append(wrap);

  // --- ヘッダー（トップと同型: eyebrow + h1 + コピー + テーマ切替 + 戻る） ---
  const themeBtn = el('button', { class: 'theme-toggle', type: 'button' }) as HTMLButtonElement;
  const updateThemeBtn = (): void => {
    const t = currentTheme();
    themeBtn.textContent = t === 'dark' ? 'ライトにする' : 'ダークにする';
    themeBtn.setAttribute(
      'aria-label',
      `表示テーマを切り替える（現在: ${t === 'dark' ? 'ダーク' : 'ライト'}）`,
    );
  };
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

  wrap.append(
    el(
      'header',
      { class: 'hero' },
      el(
        'div',
        { class: 'hero-top' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, '— 16bit 交配研究所 —'),
          el('h1', {}, '生み出されたアイデア'),
          el('p', { class: 'copy' }, 'AIが考えた未実装の発明アイデアを、すべてここに。'),
          el('p', { class: 'ideas-back' }, el('a', { href: ctx.base }, '← 交配研究所へ戻る')),
        ),
        themeBtn,
      ),
    ),
  );
  updateThemeBtn();

  // --- 注意書き（トップと同じ文言。実装済みと誤認させない） ----------------
  wrap.append(
    el(
      'div',
      { class: 'notice window' },
      'ここに並ぶのは ',
      el('strong', {}, 'AIが考えた未実装の発明アイデア'),
      ' です。実際に製作したもの・実在の成果物ではありません。 ProtoPediaの元作品は出典リンク先を参照してください。',
    ),
  );

  if (list.some((c) => c.sample)) {
    wrap.append(
      el(
        'div',
        { class: 'notice warn window' },
        '開発用サンプルの子作品を表示しています（[SAMPLE] 表記・実在の生成結果ではありません）。',
      ),
    );
  }

  // --- 一覧パネル -----------------------------------------------------------
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const panel = el(
    'div',
    { class: 'lab-panel' },
    el(
      'div',
      { class: 'lab-head' },
      el(
        'div',
        { class: 'lab-titles' },
        el('h2', {}, 'アイデア一覧'),
        el('p', { class: 'lab-sub' }, 'ALL GENERATED IDEAS'),
      ),
      el('span', { class: 'chip' }, `全${sorted.length}件`),
    ),
  );

  if (sorted.length === 0) {
    panel.append(
      el(
        'div',
        { class: 'ideas-empty' },
        el('p', { class: 'empty-title' }, 'まだアイデアは生まれていません'),
        el(
          'p',
          {},
          '研究所トップで2つの作品を選び「交配を申請」すると、毎時1枠（全ユーザー共通）でAIが新しい発明案を考えます。',
        ),
        el('p', {}, el('a', { href: ctx.base }, '交配研究所へ →')),
      ),
    );
  } else {
    const ul = el('ul', { class: 'ideas-list' });
    for (const c of sorted) ul.append(buildIdeaItem(c, ctx, titleOf));
    panel.append(ul);
  }

  wrap.append(el('section', {}, panel));
  wrap.append(
    el(
      'footer',
      { class: 'ideas-foot hint' },
      el('a', { href: ctx.base }, 'Mashup Ours トップへ'),
      ' — 20年分の発明を、もう一度マッシュアップ。',
    ),
  );
}

// 本番ページ（ideas/index.html）では自動起動。テストは buildIdeasPage を直接呼ぶ。
const hostEl = document.querySelector<HTMLElement>('#ideas-app');
if (hostEl) {
  // base が絶対（'/' や '/<repo>/'）ならそのまま。相対（'./'）ならこのページは
  // <root>/ideas/ にいるので、サイトルートへのリンクは '../'（ルート位置のページと
  // 決まりで解決）。どのドメイン・公開パスでも追従する。
  const siteBase = import.meta.env.BASE_URL.startsWith('/')
    ? import.meta.env.BASE_URL
    : '../';
  buildIdeasPage(hostEl, offspring, {
    repoCfg,
    base: siteBase,
  });
}
