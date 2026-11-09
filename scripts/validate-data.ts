/**
 * data/offspring.json の検証。
 * 使い方: npm run validate-data
 */
import { existsSync, readFileSync } from 'node:fs';
import { isCandidatesFile, nextSlotKey } from '../lib/candidates.ts';
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

// --- data/sample-prototypes.json（試作取得データ・任意） --------------------
// 存在しなくてよい。壊れた形だけを検出する。候補プールの一部として数える。

const SAMPLE_FILE = new URL('../data/sample-prototypes.json', import.meta.url);
const poolIds = new Set(workIds); // prototypes.json ∪ sample-prototypes.json = 候補プール

if (existsSync(SAMPLE_FILE)) {
  let sampleRaw: unknown;
  try {
    sampleRaw = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8'));
  } catch (e) {
    fail(`data/sample-prototypes.json を読めません: ${String(e)}`);
  }
  if (typeof sampleRaw !== 'object' || sampleRaw === null) {
    fail('sample-prototypes.json はオブジェクトである必要があります');
  }
  const sample = sampleRaw as Workset;
  if (sample.schemaVersion !== 1) fail('sample-prototypes.json: schemaVersion が 1 ではありません');
  if (!Array.isArray(sample.works)) fail('sample-prototypes.json: works が配列ではありません');

  for (const w of sample.works) {
    const wfail = (msg: string): never =>
      fail(`sample-prototypes.json ${w?.id ?? '(不明)'}: ${msg}`);
    if (typeof w?.id !== 'string' || !/^protopedia:\d{1,9}$/.test(w.id)) wfail('id 形式が不正');
    if (poolIds.has(w.id)) wfail('id がプールに重複しています');
    if (w.generation !== 0) wfail('generation は 0 である必要があります');
    if (typeof w.title !== 'string' || w.title.length === 0) wfail('title が空');
    if (typeof w.sourceUrl !== 'string' || !w.sourceUrl.startsWith('https://protopedia.net/')) {
      wfail(`sourceUrl が想定外: ${String(w.sourceUrl)}`);
    }
    if (w.sample) wfail('実API取得データに sample フラグは付かない');
    // 仕様§10: 利用条件が確認できない作品は保存しない方針（fetch時のフィールドと二重確認）
    if (typeof w.licenseType !== 'string' || w.licenseType.length === 0) {
      wfail('licenseType が無い（利用条件を確認できない作品）');
    }
    poolIds.add(w.id);
  }
  console.log(`✅ sample-prototypes.json ${sample.works.length}件 OK`);
} else {
  console.log('ℹ️ sample-prototypes.json は無し（npm run fetch:sample で取得できます）');
}

// --- data/current-candidates.json（15分ごとの配合候補） --------------------------

const CAND_FILE = new URL('../data/current-candidates.json', import.meta.url);
let candRaw: unknown;
try {
  candRaw = JSON.parse(readFileSync(CAND_FILE, 'utf8'));
} catch {
  fail('data/current-candidates.json がありません（npm run rotate:candidates を実行してください）');
}
if (!isCandidatesFile(candRaw)) {
  fail('current-candidates.json の形式が不正です（npm run rotate:candidates で作り直してください）');
}
const cand = candRaw;

// slot/nextSlotの整合（Actionsの実行結果として記録された値同士が一致しているか）
if (cand.nextSlot !== nextSlotKey(cand.slot)) {
  fail(`current-candidates.json: nextSlot（${cand.nextSlot}）が slot（${cand.slot}）の次枠と一致しません`);
}
if (Number.isNaN(Date.parse(cand.generatedAt))) {
  fail('current-candidates.json: generatedAt が日時として読めません');
}
// sourceは実行環境の絶対パスを持ち込まない（再現性の担保）
if (cand.source.startsWith('/') || cand.source.includes('..')) {
  fail(`current-candidates.json: source がリポジトリ相対ではありません: ${cand.source}`);
}
for (const c of cand.candidates) {
  if (c.sample) fail(`current-candidates.json: 候補 ${c.id} に sample フラグが付いています`);
  if (!poolIds.has(c.id)) {
    fail(
      `current-candidates.json: 候補 ${c.id} が保存済み作品プールに存在しません（npm run rotate:candidates で候補を更新してください）`,
    );
  }
}
console.log(
  `✅ current-candidates.json slot=${cand.slot} 候補${cand.candidates.length}件 OK（次回: ${cand.nextSlot} / source: ${cand.source}）`,
);
