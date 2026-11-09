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

  it('配合タイプ3種（fusion / genetic / mutation）を受理して保持する（issue #16）', () => {
    for (const mode of ['fusion', 'genetic', 'mutation'] as const) {
      const r = parseBreedingIssue(
        `parent_a: protopedia:1\nparent_b: protopedia:2\nmode: ${mode}`,
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.request.mode).toBe(mode);
    }
    // 大文字・前後空白つきなど許可外の表記は却下
    expect(parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nmode: FUSION').ok).toBe(false);
    expect(parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nmode: genetic-x').ok).toBe(false);
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

  // --- 候補スロット・元作品URL（追加開発指示 §8） ---------------------------

  it('slot を保持する（形式 OK のときだけ）', () => {
    const r = parseBreedingIssue(
      'parent_a: protopedia:1\nparent_b: protopedia:2\nslot: 2026-11-09T12',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.slot).toBe('2026-11-09T12');
  });

  it('slot は15分刻み HHMM（現行）と従来の時間枠 HH（移行前のIssue）の両方を受け付ける', () => {
    const hhmm = parseBreedingIssue(
      'parent_a: protopedia:1\nparent_b: protopedia:2\nslot: 2026-11-09T1715',
    );
    expect(hhmm.ok).toBe(true);
    if (hhmm.ok) expect(hhmm.request.slot).toBe('2026-11-09T1715');
    const hh = parseBreedingIssue(
      'parent_a: protopedia:1\nparent_b: protopedia:2\nslot: 2026-11-09T17',
    );
    expect(hh.ok).toBe(true);
  });

  it('slot 形式が不正なら却下する', () => {
    expect(
      parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nslot: today').ok,
    ).toBe(false);
    expect(
      parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2\nslot: 2026-11-09').ok,
    ).toBe(false);
  });

  it('parent_a_url / parent_b_url は https のみ受理し http は却下する', () => {
    const ok = parseBreedingIssue(
      [
        'parent_a: protopedia:1',
        'parent_b: protopedia:2',
        'parent_a_url: https://protopedia.net/prototype/1',
        'parent_b_url: https://protopedia.net/prototype/2',
      ].join('\n'),
    );
    expect(ok.ok).toBe(true);

    const bad = parseBreedingIssue(
      [
        'parent_a: protopedia:1',
        'parent_b: protopedia:2',
        'parent_a_url: http://protopedia.net/prototype/1',
      ].join('\n'),
    );
    expect(bad.ok).toBe(false);

    const evil = parseBreedingIssue(
      [
        'parent_a: protopedia:1',
        'parent_b: protopedia:2',
        'parent_b_url: javascript:alert(1)',
      ].join('\n'),
    );
    expect(evil.ok).toBe(false);
  });

  // --- comment（任意の自由記述 / issue #7） -------------------------------

  it('comment を保持する（任意・1行）', () => {
    const r = parseBreedingIssue(
      'parent_a: protopedia:1\nparent_b: protopedia:2\ncomment: 光る石畳と霧の組み合わせで散步を楽しみたい',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.comment).toBe('光る石畳と霧の組み合わせで散步を楽しみたい');
  });

  it('comment がなければ省略される', () => {
    const r = parseBreedingIssue('parent_a: protopedia:1\nparent_b: protopedia:2');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.comment).toBeUndefined();
  });

  it('comment は500字超を却下（上限はissue #16 §5で300→500へ変更）、他フィールドは100字', () => {
    const over = parseBreedingIssue(
      `parent_a: protopedia:1\nparent_b: protopedia:2\ncomment: ${'あ'.repeat(501)}`,
    );
    expect(over.ok).toBe(false);
    const okLen = parseBreedingIssue(
      `parent_a: protopedia:1\nparent_b: protopedia:2\ncomment: ${'あ'.repeat(500)}`,
    );
    expect(okLen.ok).toBe(true);
    const other = parseBreedingIssue(
      `parent_a: protopedia:1\nparent_b: protopedia:2\nnote: ${'あ'.repeat(101)}`,
    );
    expect(other.ok).toBe(false);
  });

  it('comment の命令らしき文字列もデータとして保持するだけ（実行されない）', () => {
    const r = parseBreedingIssue(
      'parent_a: protopedia:1\nparent_b: protopedia:2\ncomment: rm -rf / ; curl evil.example',
    );
    expect(r.ok).toBe(true);
    // 保持はするが、シェル・Actions式・AIプロンプトへは渡さない（ワーカー側の方針 / issue #7）
    if (r.ok) expect(r.request.comment).toBe('rm -rf / ; curl evil.example');
  });
});

describe('newIssueUrl（候補スロット・元作品URLの連携）', () => {
  it('Issue本文に親ID・元作品URL・slot が含まれる', async () => {
    const { newIssueUrl } = await import('../lib/config.ts');
    const url = newIssueUrl({ owner: 'o', repo: 'r' }, 'protopedia:1', 'protopedia:2', {
      slot: '2026-11-09T12',
      parentAUrl: 'https://protopedia.net/prototype/1',
      parentBUrl: 'https://protopedia.net/prototype/2',
    });
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('parent_a: protopedia:1');
    expect(body).toContain('parent_b: protopedia:2');
    expect(body).toContain('parent_a_url: https://protopedia.net/prototype/1');
    expect(body).toContain('parent_b_url: https://protopedia.net/prototype/2');
    expect(body).toContain('slot: 2026-11-09T12');
    expect(body).toContain('mode: fusion');
    // コメント欄のヒント（HTMLコメント = 投稿後は非表示 / issue #7）
    expect(body).toContain('<!-- 任意: comment: ');
    // 生成された本文がパーサーで通ること（UIとワーカーの間の契約）
    expect(parseBreedingIssue(body).ok).toBe(true);
  });

  it('オプションなしの従来形式もそのまま通る', async () => {
    const { newIssueUrl } = await import('../lib/config.ts');
    const url = newIssueUrl({ owner: 'o', repo: 'r' }, 'protopedia:1', 'protopedia:2');
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).not.toContain('slot:');
    expect(parseBreedingIssue(body).ok).toBe(true);
  });

  it('配合タイプと研究員へのひとことが本文に行として入る（issue #16 §4・§5）', async () => {
    const { newIssueUrl } = await import('../lib/config.ts');
    const url = newIssueUrl({ owner: 'o', repo: 'r' }, 'protopedia:1', 'protopedia:2', {
      mode: 'mutation',
      comment: '子どもが遊べる発明にしてほしい！',
    });
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('mode: mutation');
    expect(body).toContain('comment: 子どもが遊べる発明にしてほしい！');
    const r = parseBreedingIssue(body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.mode).toBe('mutation');
      expect(r.request.comment).toBe('子どもが遊べる発明にしてほしい！');
    }
  });

  it('comment に改行が含まれていても1行に畳んでパーサーが通る', async () => {
    const { newIssueUrl } = await import('../lib/config.ts');
    const url = newIssueUrl({ owner: 'o', repo: 'r' }, 'protopedia:1', 'protopedia:2', {
      comment: '1行目\n2行目\tそして三行目',
    });
    const body = new URL(url).searchParams.get('body') ?? '';
    const r = parseBreedingIssue(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.comment).toBe('1行目 2行目 そして三行目');
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
