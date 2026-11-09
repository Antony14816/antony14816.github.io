/**
 * 生成AI利用量の記録と試算。（issue #16 / 追加開発指示 §10）
 *
 * 重要な前提:
 * - Cloudflare Workers AI の利用量を取るAPIは**公式ドキュメントに存在しない（未検証）**。
 *   そのため利用量は自前でカウントする（実行回数・トークン数・エラーは実測、
 *   Neurons は公開料金表からの**試算**）。
 * - **試算値を実測値として扱わない。** 試算が計算できない（トークン未取得など）場合は
 *   0 のまま記録し、上限判定には「呼び出し回数（dailyAiCallLimit）」を使う。
 * - 無料枠の条件は変動する。「1時間に1回なら無料枠内」とは断定しない（READMEにも明記）。
 */

/** 公開料金表（2026-11確認）からの試算係数。実測ではない。 */
export const NEURON_RATE = {
  /** gpt-oss-20b: 18,182 Neurons / 100万入力トークン */
  textInputPerMTokens: 18_182,
  /** gpt-oss-20b: 27,273 Neurons / 100万出力トークン */
  textOutputPerMTokens: 27_273,
  /** flux-1-schnell: 512x512タイル1枚あたり 4.80 Neurons */
  imagePerTile: 4.8,
  /** flux-1-schnell: 1ステップあたり 9.60 Neurons */
  imagePerStep: 9.6,
} as const;

/** flux-1-schnell の既定ステップ数（公式既定値4）。 */
export const IMAGE_DEFAULT_STEPS = 4;

export interface AiUsageDay {
  /** チャット生成（要素抽出・配合生成）の呼び出し回数（実測） */
  textCalls: number;
  /** 画像生成の呼び出し回数（実測） */
  imageCalls: number;
  /** 取得できた入力トークン数合計（未取得時は0） */
  inputTokens: number;
  /** 取得できた出力トークン数合計（未取得時は0） */
  outputTokens: number;
  /** Neurons の**試算**（トークン未取得時は0。実測値として扱わない） */
  estimatedNeurons: number;
}

export interface AiUsageFile {
  schemaVersion: 1;
  /** key = UTC日付 "YYYY-MM-DD" */
  days: Record<string, AiUsageDay>;
}

/** aiCalls と同様に直近7日のみ保持（無限肥大化の防止）。 */
const HISTORY_DAYS = 7;

export function emptyAiUsage(): AiUsageFile {
  return { schemaVersion: 1, days: {} };
}

export function emptyUsageDay(): AiUsageDay {
  return { textCalls: 0, imageCalls: 0, inputTokens: 0, outputTokens: 0, estimatedNeurons: 0 };
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** data/ai-usage.json の形を検証する。壊れた日付・値は読み飛ばす。 */
export function parseAiUsage(raw: unknown): AiUsageFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyAiUsage();
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 1) return emptyAiUsage();
  const days: Record<string, AiUsageDay> = {};
  const rawDays = r.days;
  if (typeof rawDays === 'object' && rawDays !== null && !Array.isArray(rawDays)) {
    for (const [day, value] of Object.entries(rawDays as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (typeof value !== 'object' || value === null) continue;
      const d = value as Record<string, unknown>;
      days[day] = {
        textCalls: nonNegInt(d.textCalls),
        imageCalls: nonNegInt(d.imageCalls),
        inputTokens: nonNegInt(d.inputTokens),
        outputTokens: nonNegInt(d.outputTokens),
        estimatedNeurons: nonNegInt(d.estimatedNeurons),
      };
    }
  }
  return { schemaVersion: 1, days };
}

/** トークン数からの Neurons **試算**（取得できていないトークンは0のまま）。 */
export function estimateTextNeurons(inputTokens: number, outputTokens: number): number {
  const inPart = (inputTokens / 1_000_000) * NEURON_RATE.textInputPerMTokens;
  const outPart = (outputTokens / 1_000_000) * NEURON_RATE.textOutputPerMTokens;
  return Math.round(inPart + outPart);
}

/** 画像1枚の Neurons **試算**（512x512 = 1タイル・ステップ既定4）。 */
export function estimateImageNeurons(steps: number = IMAGE_DEFAULT_STEPS): number {
  return Math.round(NEURON_RATE.imagePerTile + NEURON_RATE.imagePerStep * steps);
}

export interface UsageEvent {
  kind: 'text' | 'image';
  inputTokens?: number;
  outputTokens?: number;
  /** 画像のステップ数（image のみ。未指定なら既定4） */
  steps?: number;
}

/**
 * 1回のAI呼び出しを記録する（返り値は新しいファイル。呼び出し側が保存する）。
 * 直近7日分だけを残す。
 */
export function recordAiUsage(
  file: AiUsageFile,
  day: string,
  event: UsageEvent,
  now: Date = new Date(),
): AiUsageFile {
  const days: Record<string, AiUsageDay> = {};
  const cutoff = dayAt(new Date(now.getTime() - (HISTORY_DAYS - 1) * 24 * 60 * 60_000));
  for (const [d, v] of Object.entries(file.days)) {
    if (d >= cutoff && d <= day) days[d] = v;
  }
  const cur = { ...(days[day] ?? emptyUsageDay()) };
  const inputTokens = event.inputTokens ?? 0;
  const outputTokens = event.outputTokens ?? 0;
  if (event.kind === 'text') {
    cur.textCalls += 1;
    cur.inputTokens += inputTokens;
    cur.outputTokens += outputTokens;
    cur.estimatedNeurons += estimateTextNeurons(inputTokens, outputTokens);
  } else {
    cur.imageCalls += 1;
    cur.estimatedNeurons += estimateImageNeurons(event.steps);
  }
  days[day] = cur;
  return { schemaVersion: 1, days };
}

/** UTC日付キー "YYYY-MM-DD" */
export function dayAt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Workers AI の応答からトークン数を取り出す（**未検証**: usageフィールドは公式ドキュメントに無し）。
 * 見つからなければ undefined（= 記録は回数のみ、試算は0のまま）。
 */
export function extractTokenUsage(result: unknown): { inputTokens?: number; outputTokens?: number } {
  if (typeof result !== 'object' || result === null) return {};
  const r = result as Record<string, unknown>;
  // result 内と envelope 直下の両方を見られるように（呼び出し側が渡す）。
  const usage = (r.usage ?? r) as Record<string, unknown>;
  const pick = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = usage[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
    }
    return undefined;
  };
  const inputTokens = pick('prompt_tokens', 'input_tokens', 'promptTokens');
  const outputTokens = pick('completion_tokens', 'output_tokens', 'completionTokens');
  return { inputTokens, outputTokens };
}
