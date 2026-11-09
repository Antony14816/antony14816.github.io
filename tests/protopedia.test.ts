import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROTOPEDIA_SITE_BASE,
  buildWorkset,
  fetchAllWorks,
  isPublicRelease,
  normalizeWork,
  stripToText,
  writeWorksetAtomic,
} from '../lib/protopedia.ts';

/** fetchの最小モック（検証対象はURL・ヘッダ・本文処理だけ）。 */
function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
  return { impl, calls };
}

describe('stripToText', () => {
  it('HTMLタグを除去して文字参照をデコードする', () => {
    expect(stripToText('<p>Hello <b>World</b></p>', 100)).toBe('Hello World');
    expect(stripToText('A&amp;B &lt;tag&gt; &#65;', 100)).toBe('A&B <tag> A');
  });

  it('空白を圧縮し、非文字列は空にする', () => {
    expect(stripToText('  a\n\n  b  ', 100)).toBe('a b');
    expect(stripToText(null, 100)).toBe('');
    expect(stripToText(42, 100)).toBe('');
  });

  it('長さ上限で切り詰める（末尾に…）', () => {
    const out = stripToText('あ'.repeat(50), 10);
    expect([...out]).toHaveLength(11); // 10文字 + …
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('isPublicRelease', () => {
  it('欠損は公開扱い、明示的な非公開のみ除外（仕様書§11の未確認項目を踏まえた暫定）', () => {
    expect(isPublicRelease(undefined)).toBe(true);
    expect(isPublicRelease(null)).toBe(true);
    expect(isPublicRelease(true)).toBe(true);
    expect(isPublicRelease(1)).toBe(true);
    expect(isPublicRelease('Y')).toBe(true);
    expect(isPublicRelease(false)).toBe(false);
    expect(isPublicRelease(0)).toBe(false);
    expect(isPublicRelease('N')).toBe(false);
    expect(isPublicRelease('private')).toBe(false);
  });
});

describe('normalizeWork', () => {
  const valid = {
    id: 1234,
    prototypeNm: '光る地図スタンド',
    summary: '<b>概要</b>テキスト',
    users: [{ userNm: '作者A' }, { userNm: '作者B' }],
    tags: [{ tagNm: 'Arduino' }, { tagNm: '光' }],
    licenseType: 'CC BY 4.0',
    releaseFlg: true,
    mainUrl: 'https://example.com/img.png',
    systemDescription: 'Arduino + LED',
    freeComment: '詳細説明',
  };

  it('検証済みフィールドに正規化する', () => {
    const w = normalizeWork(valid);
    expect(w).not.toBeNull();
    expect(w!.id).toBe('protopedia:1234');
    expect(w!.title).toBe('光る地図スタンド');
    expect(w!.summary).toBe('概要テキスト');
    expect(w!.sourceUrl).toBe(`${PROTOPEDIA_SITE_BASE}/prototype/1234`);
    expect(w!.authors).toEqual(['作者A', '作者B']);
    expect(w!.tags).toEqual(['Arduino', '光']);
    expect(w!.licenseType).toBe('CC BY 4.0');
    expect(w!.mainUrl).toBe('https://example.com/img.png');
    expect(w!.systemDescription).toBe('Arduino + LED');
    expect(w!.description).toBe('詳細説明');
    expect(w!.generation).toBe(0);
    expect(w!.sample).toBeUndefined();
  });

  it('IDなし・作品名なし・非公開は null（壊れたレコードを黙って通さない）', () => {
    expect(normalizeWork({ prototypeNm: '名前だけ' })).toBeNull();
    expect(normalizeWork({ id: 1234 })).toBeNull();
    expect(normalizeWork({ ...valid, releaseFlg: false })).toBeNull();
    expect(normalizeWork(null)).toBeNull();
    expect(normalizeWork('文字列レスポンス')).toBeNull();
    expect(normalizeWork({ ...valid, id: 'abc' })).toBeNull();
  });

  it('出典URLは protopedia.net 以外を拒否して組み立てURLに落とす', () => {
    const w = normalizeWork({ ...valid, url: 'https://evil.example/steal' });
    expect(w!.sourceUrl).toBe(`${PROTOPEDIA_SITE_BASE}/prototype/1234`);
    const w2 = normalizeWork({ ...valid, url: 'javascript:alert(1)' });
    expect(w2!.sourceUrl).toBe(`${PROTOPEDIA_SITE_BASE}/prototype/1234`);
  });

  it('http画像は捨て、httpsのみ保持', () => {
    expect(normalizeWork({ ...valid, mainUrl: 'http://insecure/x.png' })!.mainUrl).toBeUndefined();
    expect(normalizeWork({ ...valid, mainUrl: 'not a url' })!.mainUrl).toBeUndefined();
  });

  it('summaryが空ならfreeCommentで代用し、long textは上限で切る', () => {
    const w = normalizeWork({ ...valid, summary: '', freeComment: 'あ'.repeat(5000) });
    expect(w!.summary).toBe('あ'.repeat(600) + '…');
    expect([...w!.description!]).toHaveLength(2001);
  });
});

describe('fetchAllWorks', () => {
  const page = (ids: number[]) => ({ results: ids.map((id) => ({ id, prototypeNm: `作品${id}` })) });

  it('limit/offsetでページングし、Bearerトークンで呼ぶ', async () => {
    const { impl, calls } = mockFetch((url) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset'));
      return offset === 0 ? { status: 200, body: page([1, 2]) } : { status: 200, body: page([3]) };
    });
    const result = await fetchAllWorks({ token: 'test-token', pageSize: 2, fetchImpl: impl });
    expect(result.works.map((w) => w.id)).toEqual(['protopedia:1', 'protopedia:2', 'protopedia:3']);
    expect(result.pages).toBe(2);
    expect(calls[0]).toContain('limit=2&offset=0');
    expect(calls[1]).toContain('offset=2');
    // トークンはヘッダだけ（URLに入れない）
    expect(calls[0]).not.toContain('test-token');
  });

  it('5xxは1回だけ再試行してから成功する', async () => {
    let n = 0;
    const { impl } = mockFetch(() => {
      n += 1;
      return n === 1 ? { status: 500, body: {} } : { status: 200, body: page([1]) };
    });
    const result = await fetchAllWorks({ token: 't', pageSize: 10, fetchImpl: impl });
    expect(result.works).toHaveLength(1);
    expect(n).toBe(2);
  });

  it('常に失敗なら例外（=同期スクリプトは既存データを保持する）', async () => {
    const { impl } = mockFetch(() => ({ status: 401, body: {} }));
    await expect(fetchAllWorks({ token: 'bad', retries: 1, fetchImpl: impl })).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('結果配列がないレスポンスは例外', async () => {
    const { impl } = mockFetch(() => ({ status: 200, body: { unexpected: true } }));
    await expect(fetchAllWorks({ token: 't', fetchImpl: impl })).rejects.toThrow(
      '結果配列が見つかりません',
    );
  });

  it('不正レコードは落として数え、maxWorksで打ち切る', async () => {
    const { impl } = mockFetch((url) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset'));
      const ids = offset === 0 ? [1, -5, 3] : [4, 5];
      return { status: 200, body: page(ids) };
    });
    const result = await fetchAllWorks({ token: 't', pageSize: 3, maxWorks: 4, fetchImpl: impl });
    expect(result.works.length).toBeLessThanOrEqual(4);
    expect(result.dropped).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(true);
  });

  it('トークン未設定は即例外', async () => {
    await expect(fetchAllWorks({ token: '' })).rejects.toThrow('トークン');
  });
});

describe('writeWorksetAtomic（キャッシュ保護）', () => {
  it('0件は拒否して既存ファイルを変更しない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mashup-'));
    const out = join(dir, 'prototypes.json');
    writeFileSync(out, '{"previous":"data"}', 'utf8');
    const empty = buildWorkset([], 'protopedia-api-v2');
    expect(() => writeWorksetAtomic(out, empty)).toThrow('0件');
    expect(readFileSync(out, 'utf8')).toBe('{"previous":"data"}');
  });

  it('成功時はJSONを書き、一時ファイルを残さない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mashup-'));
    const out = join(dir, 'prototypes.json');
    const workset = buildWorkset(
      [
        {
          id: 'protopedia:1',
          title: 'T',
          sourceUrl: `${PROTOPEDIA_SITE_BASE}/prototype/1`,
          summary: 'S',
          generation: 0,
        },
      ],
      'protopedia-api-v2',
    );
    writeWorksetAtomic(out, workset);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.works).toHaveLength(1);
    expect(typeof parsed.syncedAt).toBe('string');
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });
});
