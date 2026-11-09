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
