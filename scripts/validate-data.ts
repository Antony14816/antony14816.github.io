/**
 * data/offspring.json の検証。
 * 使い方: npm run validate-data
 */
import { readFileSync } from 'node:fs';
import { computeGeneration, isAncestorDescendantPair, nextOffspringId } from '../lib/generation.ts';
import { samePair } from '../lib/issue.ts';
import type { Offspring } from '../lib/types.ts';

const FILE = new URL('../data/offspring.json', import.meta.url);

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
