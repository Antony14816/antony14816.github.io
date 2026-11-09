/**
 * 生成AI利用量の記録・試算のテスト（issue #16 / 追加開発指示 §10）。
 * - Neurons は**試算**（回数のみ実測）。試算できない場合は0のまま
 * - 直近7日分だけ保持する
 * - 壊れた ai-usage.json は安全側で読み替える
 */
import { describe, expect, it } from 'vitest';
import {
  IMAGE_DEFAULT_STEPS,
  NEURON_RATE,
  dayAt,
  emptyAiUsage,
  estimateImageNeurons,
  estimateTextNeurons,
  extractTokenUsage,
  parseAiUsage,
  recordAiUsage,
} from '../lib/usage.ts';

describe('estimateTextNeurons（試算）', () => {
  it('公開料金表の係数から計算する', () => {
    // 100万入力トークンちょうど
    expect(estimateTextNeurons(1_000_000, 0)).toBe(NEURON_RATE.textInputPerMTokens);
    expect(estimateTextNeurons(0, 1_000_000)).toBe(NEURON_RATE.textOutputPerMTokens);
    expect(estimateTextNeurons(0, 0)).toBe(0);
    // 1000トークンずつ → 丸めは整数
    const v = estimateTextNeurons(1000, 1000);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});

describe('estimateImageNeurons（試算）', () => {
  it('512x512=1タイル + ステップ既定4', () => {
    expect(IMAGE_DEFAULT_STEPS).toBe(4);
    expect(estimateImageNeurons()).toBe(
      Math.round(NEURON_RATE.imagePerTile + NEURON_RATE.imagePerStep * IMAGE_DEFAULT_STEPS),
    );
    expect(estimateImageNeurons(8)).toBe(
      Math.round(NEURON_RATE.imagePerTile + NEURON_RATE.imagePerStep * 8),
    );
    expect(estimateImageNeurons()).toBeGreaterThan(0);
  });
});

describe('recordAiUsage', () => {
  it('テキスト呼び出しを加算し、トークン分の試算を足す', () => {
    const day = '2026-11-10';
    let f = recordAiUsage(
      emptyAiUsage(),
      day,
      { kind: 'text', inputTokens: 1000, outputTokens: 500 },
      new Date('2026-11-10T01:00:00Z'),
    );
    f = recordAiUsage(f, day, { kind: 'text' }, new Date('2026-11-10T02:00:00Z'));
    const d = f.days[day];
    expect(d.textCalls).toBe(2);
    expect(d.imageCalls).toBe(0);
    expect(d.inputTokens).toBe(1000);
    expect(d.outputTokens).toBe(500);
    expect(d.estimatedNeurons).toBe(estimateTextNeurons(1000, 500)); // 2回目はトークン0=試算0
  });

  it('画像呼び出しは回数と試算だけ加算する（トークンは増えない）', () => {
    const day = '2026-11-10';
    const f = recordAiUsage(emptyAiUsage(), day, { kind: 'image' }, new Date('2026-11-10T01:00:00Z'));
    expect(f.days[day].imageCalls).toBe(1);
    expect(f.days[day].estimatedNeurons).toBe(estimateImageNeurons());
    expect(f.days[day].inputTokens).toBe(0);
  });

  it('直近7日を超えた古い日は捨てられる（無限肥大化の防止）', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    // 記録は常に「今日」に対して行う（ワーカーの使い方）
    const f = recordAiUsage(
      { schemaVersion: 1, days: { '2026-11-01': { ...zero(), textCalls: 9 } } },
      '2026-11-10',
      { kind: 'text' },
      now,
    );
    expect(f.days['2026-11-01']).toBeUndefined(); // 7日より前 = 切り捨て
    expect(f.days['2026-11-10'].textCalls).toBe(1);
    // 7日以内の日は残る
    const inside = recordAiUsage(
      { schemaVersion: 1, days: { '2026-11-05': { ...zero(), textCalls: 3 } } },
      '2026-11-10',
      { kind: 'image' },
      now,
    );
    expect(inside.days['2026-11-05'].textCalls).toBe(3);
    expect(inside.days['2026-11-10'].imageCalls).toBe(1);
  });
});

function zero() {
  return { textCalls: 0, imageCalls: 0, inputTokens: 0, outputTokens: 0, estimatedNeurons: 0 };
}

describe('parseAiUsage', () => {
  it('正常なファイルを読む', () => {
    const f = {
      schemaVersion: 1,
      days: { '2026-11-10': { ...zero(), textCalls: 2, estimatedNeurons: 100 } },
    };
    expect(parseAiUsage(f)).toEqual(f);
  });

  it('不正な日付キー・負数・小数・非数値を読み飛ばす（壊れていても0扱いにしない全体は壊さない）', () => {
    const parsed = parseAiUsage({
      schemaVersion: 1,
      days: {
        '2026-11-10': { ...zero(), textCalls: 2, imageCalls: -1, estimatedNeurons: 1.5 },
        'not-a-day': { ...zero(), textCalls: 5 },
        '2026/11/10': { ...zero(), textCalls: 5 },
        bad: 'x',
      },
    });
    expect(Object.keys(parsed.days)).toEqual(['2026-11-10']);
    expect(parsed.days['2026-11-10'].textCalls).toBe(2);
    expect(parsed.days['2026-11-10'].imageCalls).toBe(0); // 負数は0
    expect(parsed.days['2026-11-10'].estimatedNeurons).toBe(0); // 小数は0
  });

  it('未知スキーマ・配列・null は空ファイル', () => {
    expect(parseAiUsage({ schemaVersion: 2, days: {} }).days).toEqual({});
    expect(parseAiUsage([]).days).toEqual({});
    expect(parseAiUsage(null).days).toEqual({});
  });
});

describe('dayAt', () => {
  it('UTC日付キーを作る', () => {
    expect(dayAt(new Date('2026-11-10T23:59:59Z'))).toBe('2026-11-10');
    expect(dayAt(new Date('2026-11-11T00:00:00Z'))).toBe('2026-11-11');
  });
});

describe('extractTokenUsage（未検証: usageフィールドは公式ドキュメントに無い）', () => {
  it('OpenAI互換の usage を拾う', () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 100, completion_tokens: 20 } })).toEqual({
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('別名（input_tokens / output_tokens）も拾う', () => {
    expect(extractTokenUsage({ input_tokens: 7, output_tokens: 3 })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    });
  });

  it('無ければ undefined のまま（= 記録は回数のみ・試算は0）', () => {
    expect(extractTokenUsage({})).toEqual({});
    expect(extractTokenUsage(null)).toEqual({});
    expect(extractTokenUsage({ usage: { prompt_tokens: -5 } })).toEqual({});
    expect(extractTokenUsage({ usage: { prompt_tokens: 'abc' } })).toEqual({});
  });
});
