/**
 * 共有型定義: フロントエンド / ワーカー / バリデーションすべてで使う。
 */

/** 親作品のID。namespaced で表す。 */
export type ParentId = `protopedia:${number}` | `mashup-${string}`;

/** ProtoPedia の元作品（第0世代）。出典URL必須。 */
export interface ProtopediaWork {
  id: ParentId;
  /** ProtoPedia 上の作品名 */
  title: string;
  /** 出典URL（ProtoPediaの作品ページ） */
  sourceUrl: string;
  summary: string;
  generation: 0;
  /** 開発用サンプルデータかどうか。本番の作品と混同させない。 */
  sample?: boolean;
  /** 以下は ProtoPedia API v2 同期（docs/protopediaapi.md）で付与される任意フィールド。 */
  /** メイン画像URL（https のみ許可、取得時に検証済み） */
  mainUrl?: string;
  /** 作者名（クレジット表示用） */
  authors?: string[];
  tags?: string[];
  /** ライセンス表記（実APIの数値enumをラベル化。不明な値は保存しない） */
  licenseType?: string;
  /** 技術構成（systemDescription）。生成AIへの参考資料として使う（長さ上限つき）。 */
  systemDescription?: string;
  // 注: 詳細説明（freeComment）は保存しない（仕様書§7「詳細説明を無制限に保存せず」）。
  // 配合時に入力が必要な場合はワーカーが prototypeId でAPIから直接取得する（§6.2）。
}

/**
 * 同期済み作品セット。data/prototypes.json の形。
 * GitHub Pages はこれを読むだけで ProtoPedia API を直接呼ばない。
 */
export interface Workset {
  schemaVersion: 1;
  source: 'protopedia-api-v2' | 'mock';
  /** 最終同期日時（ISO 8601）。未同期なら null。 */
  syncedAt: string | null;
  works: ProtopediaWork[];
}

/** 継承した特徴の記述。 */
export interface InheritedTrait {
  parentId: ParentId;
  trait: string;
}

/** 生成AIが生み出した子作品（「未実装のアイデア」）。 */
export interface Offspring {
  id: string; // e.g. "mashup-000001"
  schemaVersion: 1;
  title: string;
  summary: string;
  concept: string;
  mechanism: string;
  inheritedTraits: InheritedTrait[];
  parents: [ParentId, ParentId];
  generation: number;
  mode: BreedingMode;
  sourceIssue: number;
  slot: string; // "YYYY-MM-DDTHH" (UTC)
  createdAt: string; // ISO 8601
  model: string;
  status: 'idea';
  /** 開発用サンプルデータの場合のみ true。UIで明示すること。 */
  sample?: boolean;
  whyInteresting?: string;
  implementationSketch?: string;
  /** 利用場面（AI出力 useCases / issue #16）。 */
  useCases?: string[];
  /** サムネイル画像のサイトルート相対パス。生成失敗時は null（共通プレースホルダー表示）。 */
  imagePath?: string | null;
  /** 画像生成に使ったプロンプト（再生成・検証用）。 */
  imagePrompt?: string;
}

/**
 * 配合タイプ（追加開発指示 §4 / issue #16）。
 * - fusion:   単純配合 — 2作品の特徴を自然に組み合わせる
 * - genetic:  遺伝子配合 — 要素を抽出して組替え、継承元を明示する
 * - mutation: 突然変異配合 — 意外性を優先する（実現方法は説明可能な範囲で）
 */
export type BreedingMode = 'fusion' | 'genetic' | 'mutation';

/** 配合タイプのUIラベル（Issue・一覧・詳細で共通表示）。 */
export const BLEND_MODE_LABELS: Record<BreedingMode, string> = {
  fusion: '単純配合',
  genetic: '遺伝子配合',
  mutation: '突然変異配合',
};

/** 配合タイプの説明（選択時に表示する / 追加開発指示 §4）。 */
export const BLEND_MODE_DESCRIPTIONS: Record<BreedingMode, string> = {
  fusion: '2つの発明の特徴を自然に組み合わせます。片方だけの案は避け、技術と体験が一体化した発明にします。',
  genetic: '2作品から要素を一つずつ抽出し、新しい構成に組み替えます。どの親から何を受け継いだかを明示します。',
  mutation: '意外性を優先します。少し飛び抜けた案でも、実現方法が説明できる範囲で生成します。',
};

/** Issue本文・UIの選択肢で許可する配合タイプ。 */
export const BREEDING_MODES: readonly BreedingMode[] = ['fusion', 'genetic', 'mutation'];

export function isBreedingMode(v: unknown): v is BreedingMode {
  return typeof v === 'string' && (BREEDING_MODES as readonly string[]).includes(v);
}

/** Issue本文で許可するフィールド。パーサーはこの形以外を受理しない。 */
export interface BreedingRequest {
  schemaVersion: 1;
  parentA: ParentId;
  parentB: ParentId;
  mode: BreedingMode;
  /** 申請時の候補スロット（任意）。形式: UTC "YYYY-MM-DDTHHMM"・15分刻み（従来の "YYYY-MM-DDTHH" も許容 / issue #10） */
  slot?: string;
  /** 任意の自由記述コメント（1行・最大500字 / issue #7、上限変更 issue #16）。データとして保持するだけ。 */
  comment?: string;
}
