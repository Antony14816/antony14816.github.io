/**
 * data/offspring.json の検証。
 * 使い方: npm run validate-data
 */
import { readFileSync } from 'node:fs';
import { computeGeneration, isAncestorDescendantPair, nextOffspringId } from '../lib/generation.ts';
import { samePair } from '../lib/issue.ts';
import type { Offspring, Workset } from '../lib/types.ts';

const FILE = new URL('../data/offspring.json', import.meta.url);
const WORKSET_FILE = new URL('../data/prototypes.json', import.meta.url);

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

let data: unknown;
try {
  data = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (e) {
  fail(`data/offspring.json を読めません: ${String(e)}`);
}

if (!Array.isArray(data)) fail('offspring.json は配列である必要があります');

const items = data as Offspring[];
const ids = new Set<string>();
const edges: [string, string][] = [];
let expectedNextId: string[] = [];

for (const item of items) {
  const at = (cond: boolean, msg: string) => {
    if (!cond) fail(`${item.id ?? '(ID不明)'}: ${msg}`);
  };

  at(typeof item.id === 'string' && /^mashup-\d{6}$/.test(item.id), 'id 形式が不正');
  at(!ids.has(item.id), 'id が重複しています');
  ids.add(item.id);

  at(item.schemaVersion === 1, 'schemaVersion が 1 ではありません');
  at(item.status === 'idea', 'status は idea である必要があります');
  at(item.parents?.length === 2, 'parents は2つ必要');
  at(item.parents[0] !== item.parents[1], '親が同一');
  at(typeof item.generation === 'number', 'generation がありません');
  at(/^protopedia:\d{1,9}$|^mashup-\d{1,9}$/.test(item.parents[0]), 'parent id 形式が不正');
  at(/^protopedia:\d{1,9}$|^mashup-\d{1,9}$/.test(item.parents[1]), 'parent id 形式が不正');
  at(Array.isArray(item.inheritedTraits) && item.inheritedTraits.length === 2, 'inheritedTraits は2件必要');
  at(/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(item.slot), 'slot 形式が不正（YYYY-MM-DDTHH）');
  at(typeof item.sourceIssue === 'number', 'sourceIssue がありません');

  for (const p of item.parents) {
    if (p.startsWith('mashup-') && !ids.has(p)) {
      fail(`${item.id}: 未登録の子作品を親にしています: ${p}（並び順が世代順ではありませんか）`);
    }
    edges.push([p, item.id]);
  }
  expectedNextId.push(item.id);
}

// 世代計算の再検証
const genOf = new Map<string, number>();
for (const item of items) {
  const parentGens = item.parents.map((p) =>
    p.startsWith('protopedia:') ? 0 : genOf.get(p) ?? -1,
  );
  if (parentGens.some((g) => g < 0)) fail(`${item.id}: 親の世代が未解決`);
  const expected = computeGeneration(parentGens);
  if (expected !== item.generation) {
    fail(`${item.id}: generation が不正（${item.generation} ≠ 期待値 ${expected}）`);
  }
  genOf.set(item.id, item.generation);
}

// 循環参照・重複ペア
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    if (samePair(items[i].parents, items[j].parents)) {
      fail(`同じ親の組み合わせが重複: ${items[i].id} / ${items[j].id}`);
    }
  }
}
for (const item of items) {
  const others = edges.filter(([, c]) => c !== item.id);
  if (isAncestorDescendantPair(item.parents[0], item.parents[1], others)) {
    fail(`${item.id}: 親の一方がもう一方の先祖です（近親交配）`);
  }
}

const next = nextOffspringId(expectedNextId);
console.log(`✅ ${items.length}件の子作品が検証OK（次のID: ${next}）`);

// --- data/prototypes.json（ProtoPedia同期データ） --------------------------
// 未同期（works: []）は正常状態。壊れた形だけを検出する。

let worksetRaw: unknown;
try {
  worksetRaw = JSON.parse(readFileSync(WORKSET_FILE, 'utf8'));
} catch (e) {
  fail(`data/prototypes.json を読めません: ${String(e)}`);
}

if (typeof worksetRaw !== 'object' || worksetRaw === null) {
  fail('prototypes.json はオブジェクトである必要があります');
}
const workset = worksetRaw as Workset;
if (workset.schemaVersion !== 1) fail('prototypes.json: schemaVersion が 1 ではありません');
if (workset.source !== 'protopedia-api-v2' && workset.source !== 'mock') {
  fail('prototypes.json: source が不正');
}
if (workset.syncedAt !== null && typeof workset.syncedAt !== 'string') {
  fail('prototypes.json: syncedAt は文字列または null');
}
if (!Array.isArray(workset.works)) fail('prototypes.json: works が配列ではありません');

const workIds = new Set<string>();
for (const w of workset.works) {
  const wfail = (msg: string): never => fail(`prototypes.json ${w?.id ?? '(不明)'}: ${msg}`);
  if (typeof w?.id !== 'string' || !/^protopedia:\d{1,9}$/.test(w.id)) wfail('id 形式が不正');
  if (workIds.has(w.id)) wfail('id が重複しています');
  workIds.add(w.id);
  if (w.generation !== 0) wfail('generation は 0 である必要があります');
  if (typeof w.title !== 'string' || w.title.length === 0) wfail('title が空');
  if (typeof w.sourceUrl !== 'string' || !w.sourceUrl.startsWith('https://protopedia.net/')) {
    wfail(`sourceUrl が想定外: ${String(w.sourceUrl)}`);
  }
  if (w.sample) wfail('本番データに sample フラグは付かない');
}
console.log(
  `✅ prototypes.json ${workset.works.length}件 OK（同期: ${workset.syncedAt ?? '未実施'}）`,
);
