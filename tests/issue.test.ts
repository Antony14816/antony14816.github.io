import { describe, expect, it } from 'vitest';
import { parseBreedingIssue, samePair, validateParents } from '../lib/issue.ts';
import type { BreedingRequest } from '../lib/types.ts';

describe('parseBreedingIssue', () => {
  it('正しい本文を受理する', () => {
    const body = ['parent_a: protopedia:1234', 'parent_b: protopedia:5678', 'mode: fusion'].join('\n');
    const r = parseBreedingIssue(body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.parentA).toBe('protopedia:1234');
      expect(r.request.parentB).toBe('protopedia:5678');
      expect(r.request.mode).toBe('fusion');
    }
  });

  it('mode省略時は fusion とみなす', () => {
    const r = parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.mode).toBe('fusion');
  });

  it('同一IDの親を却下する', () => {
    const r = parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:1');
    expect(r.ok).toBe(false);
  });

  it('不正なID形式をAI呼び出し前に却下する', () => {
    expect(parseBreedingIssue('parent_a: ../../etc/passwd\nparent_b: protopedia:2').ok).toBe(false);
    expect(parseBreedingIssue('parent_a: protopedia:123456789012345\nparent_b: protopedia:2').ok).toBe(false);
    expect(parseBreedingIssue('parent_a: github:1\nparent_b: protopedia:2').ok).toBe(false);
  });

  it('必須フィールド欠落を却下する', () => {
    expect(parseBreedingIssue('mode: fusion').ok).toBe(false);
    expect(parseBreedingIssue('parent_a: protopedia:1').ok).toBe(false);
  });

  it('未知のmodeを却下する', () => {
    const r = parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nmode: overwrite');
    expect(r.ok).toBe(false);
  });

  it('未対応のschema_versionを却下する', () => {
    const r = parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nschema_version: 99');
    expect(r.ok).toBe(false);
  });

  it('巨大な本文を拒否する', () => {
    const big = `parent_a: protopedia:1\nparent_b: protopedia:2\nnote: ${'x'.repeat(5000)}`;
    expect(parseBreedingIssue(big).ok).toBe(false);
  });

  it('Shellらしき文字列はデータとして無視される（命令として実行されない形でパースされる）', () => {
    const r = parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nrun: rm -rf /');
    // run は許可フィールドではないため読み込まれない
    expect(r.ok).toBe(true);
  });
});

describe('samePair', () => {
  it('順序を問わず同じ組み合わせを検出する', () => {
    expect(samePair(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(samePair(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(samePair(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('validateParents', () => {
  const proto = new Set(['protopedia:1', 'protopedia:2']);
  const kids = new Set(['mashup-000001']);
  const req = (a: string, b: string): BreedingRequest => ({
    schemaVersion: 1,
    parentA: a as BreedingRequest['parentA'],
    parentB: b as BreedingRequest['parentB'],
    mode: 'fusion',
  });

  it('実在するProtoPedia作品と子作品の組み合わせを受理する', () => {
    expect(validateParents(req('protopedia:1', 'mashup-000001'), proto, kids).ok).toBe(true);
  });

  it('存在しないProtoPedia作品を却下する', () => {
    expect(validateParents(req('protopedia:999', 'protopedia:1'), proto, kids).ok).toBe(false);
  });

  it('まだ生まれていない子作品を親にできない', () => {
    expect(validateParents(req('mashup-000002', 'protopedia:1'), proto, kids).ok).toBe(false);
  });

  it('未知の名前空間を素通りさせない', () => {
    expect(validateParents(req('github:1', 'protopedia:1'), proto, kids).ok).toBe(false);
    expect(validateParents(req('mashup:1', 'protopedia:1'), proto, kids).ok).toBe(false);
  });
});
