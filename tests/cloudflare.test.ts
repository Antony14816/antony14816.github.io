/**
 * Cloudflare Workers AI アダプターのテスト（issue #16 / 追加開発指示 §9）。
 * - envelope（{result, success, errors}）の検証
 * - エラー分類（認証 / レート / サーバー / 要求 / 通信）と再試行上限
 * - **エラーメッセージにトークンが出ないこと**
 * - 応答からの成果物抽出（テキスト / 画像 base64）
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CfError,
  cfAiRun,
  decodeBase64Image,
  extractChatText,
  extractImageBase64,
} from '../lib/cloudflare.ts';

const BASE = {
  accountId: 'ACC123',
  apiToken: 'SECRET-TOKEN-DO-NOT-LEAK',
  model: '@cf/openai/gpt-oss-20b',
  body: { messages: [] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cfAiRun', () => {
  it('成功時は envelope の result を返す', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ result: { response: 'hello' }, success: true, errors: [], messages: [] }),
    );
    const result = await cfAiRun({ ...BASE, fetchImpl });
    expect(result).toEqual({ response: 'hello' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Authorization ヘッダにトークンが入り、エラーには漏れない（401 = auth・再試行なし）', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      expect(auth).toBe('Bearer SECRET-TOKEN-DO-NOT-LEAK');
      return jsonResponse({}, 401);
    });
    const err = await cfAiRun({ ...BASE, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CfError);
    const cf = err as CfError;
    expect(cf.kind).toBe('auth');
    expect(cf.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 認証エラーは再試行しない
    expect(cf.message).not.toContain('SECRET-TOKEN-DO-NOT-LEAK');
    expect(cf.message).not.toContain('Bearer');
  });

  it('429/5xx は上限つきで再試行し、最後に server/rate で失敗する', async () => {
    const rate = vi.fn(async () => jsonResponse({}, 429));
    const err1 = (await cfAiRun({ ...BASE, fetchImpl: rate, retries: 1 }).catch(
      (e: unknown) => e,
    )) as CfError;
    expect(err1.kind).toBe('rate');
    expect(rate).toHaveBeenCalledTimes(2); // 1回目 + 再試行1回 = 上限

    const server = vi.fn(async () => jsonResponse({}, 503));
    const err2 = (await cfAiRun({ ...BASE, fetchImpl: server, retries: 1 }).catch(
      (e: unknown) => e,
    )) as CfError;
    expect(err2.kind).toBe('server');
    expect(server).toHaveBeenCalledTimes(2);
  });

  it('success=false の envelope は response エラー（上限つきで再試行）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, errors: [{ code: 1000, message: 'model unavailable' }] }),
    );
    const err = (await cfAiRun({ ...BASE, fetchImpl, retries: 1 }).catch((e: unknown) => e)) as CfError;
    expect(err).toBeInstanceOf(CfError);
    expect(err.kind).toBe('response');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(err.message).toContain('1000'); // エラーコードは拾う（本文・トークンは拾わない）
  });

  it('result が無い envelope は response エラー', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    const err = (await cfAiRun({ ...BASE, fetchImpl, retries: 0 }).catch((e: unknown) => e)) as CfError;
    expect(err.kind).toBe('response');
  });

  it('未設定の認証情報は API を呼ばずに auth エラー', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      cfAiRun({ ...BASE, apiToken: '', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('タイムアウトは timeout 種別（AbortError を判定）', async () => {
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        }),
    );
    const err = (await cfAiRun({ ...BASE, fetchImpl, retries: 0 }).catch((e: unknown) => e)) as CfError;
    expect(err.kind).toBe('timeout');
    expect(err.retryable).toBe(true);
  });
});

describe('extractChatText（OpenAI互換形式は実接続で確認済み / 候補も吸収）', () => {
  it('result.response（Workers AI の慣例）を拾う', () => {
    expect(extractChatText({ response: 'あ' })).toBe('あ');
  });
  it('OpenAI互換の choices[0].message.content を拾う', () => {
    expect(extractChatText({ choices: [{ message: { content: 'い' } }] })).toBe('い');
  });
  it('choices[0].text を拾う', () => {
    expect(extractChatText({ choices: [{ text: 'う' }] })).toBe('う');
  });
  it('result が文字列そのまま', () => {
    expect(extractChatText('え')).toBe('え');
  });
  it('どれにも当てはまらなければ空文字（呼び出し側が失敗扱い）', () => {
    expect(extractChatText({})).toBe('');
    expect(extractChatText(null)).toBe('');
    expect(extractChatText(42)).toBe('');
  });
  it('推論モデルで content=null のときは思考を本文として誤採用しない（実測形式）', () => {
    // 実測 2026-11: max_tokens が思考で枯渇すると content=null / finish_reason=length
    expect(
      extractChatText({
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'The user says: 「OK」とだけ返してください…',
            },
            finish_reason: 'length',
          },
        ],
        usage: { prompt_tokens: 76, completion_tokens: 20, total_tokens: 96, neurons: 1.927 },
      }),
    ).toBe('');
    // include_reasoning=false のとき（本文だけが返る実形式）
    expect(
      extractChatText({
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      }),
    ).toBe('OK');
  });
});

describe('画像 base64（flux-1-schnell）', () => {
  it('result.image を data URL 付きでも素でも拾う', () => {
    expect(extractImageBase64({ image: 'data:image/jpeg;base64,AAAA' })).toBe(
      'data:image/jpeg;base64,AAAA',
    );
    expect(extractImageBase64({ image: 'QUJD' })).toBe('QUJD');
    expect(extractImageBase64({})).toBe('');
  });

  it('data URL・素の base64 を Buffer にデコードする', () => {
    const b64 = Buffer.from('hello image').toString('base64');
    expect(decodeBase64Image(`data:image/jpeg;base64,${b64}`).toString()).toBe('hello image');
    expect(decodeBase64Image(b64).toString()).toBe('hello image');
  });

  it('不正な base64 は response エラー（黙って壊さない）', () => {
    expect(() => decodeBase64Image('!!!not-base64!!!')).toThrow(CfError);
    expect(() => decodeBase64Image('')).toThrow(CfError);
  });
});
