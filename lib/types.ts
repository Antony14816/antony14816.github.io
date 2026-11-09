/**
 * 共有型定義: フロントエンド / ワーカー / バリデーションすべてで使う。
 */

/** 親作品のID。namespaced で表す。 */
export type ParentId = `protopedia:${number}` | `mashup:${string}`;

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
  /** ライセンス表記（利用条件の確認に使う。実APIでの提供有無は未検証） */
  licenseType?: string;
  /** 技術構成（systemDescription）。生成AIへの参考資料として使う。 */
  systemDescription?: string;
  /** 詳細説明（freeComment）。長さ上限つき。 */
  description?: string;
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
}

export type BreedingMode = 'fusion';

/** Issue本文で許可するフィールド。パーサーはこの形以外を受理しない。 */
export interface BreedingRequest {
  schemaVersion: 1;
  parentA: ParentId;
  parentB: ParentId;
  mode: BreedingMode;
}
