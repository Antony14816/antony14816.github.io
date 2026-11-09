# ProtoPedia API v2 接続仕様書

**対象プロジェクト：** Mashup Ours  
**作成日：** 2026年11月9日  
**用途：** ProtoPedia作品の取得・検索・交配・家系図表示

## 1. 概要

Mashup Oursは、ProtoPediaに登録された2つの作品を選び、生成AIによって新しい発明アイデアを生み出すWebサービスである。

ProtoPedia API v2を利用して作品情報を取得し、交配する作品の選択、作品情報の解析、発明の系譜の可視化を実現する。

### 基本方針

- ProtoPedia API v2を利用する。
- 認証が必要なAPI通信はサーバー側で実行する。
- GitHub Actionsで作品データを取得する。
- 公開可能な作品データをJSON形式で保存する。
- GitHub PagesからJSONを読み込む。
- 元作品へのリンクと作者情報を表示する。
- APIトークンをブラウザへ公開しない。

## 2. 公式ドキュメント

| 項目 | URL |
|---|---|
| API v2公式ドキュメント | https://protopediav2.apidog.io/ |
| API v2開発素材 | https://protopedia.net/material/1863 |
| APIトークン管理 | https://protopedia.net/settings/application |

基本URL：

`https://protopedia.net/v2/api`

認証方式：

`Authorization: Bearer <token>`

GitHub Actionsでは環境変数 `PROTOPEDIA_API_V2_TOKEN` を使用する。

## 3. APIエンドポイント

### 3.1 作品一覧取得

**GET `/prototype/list`**

作品データの一覧取得、および条件による絞り込みに使用する。

主なクエリパラメータ：

| パラメータ | 用途 |
|---|---|
| `prototypeId` | 作品ID |
| `userNm` | 作者名 |
| `materialNm` | 開発素材名 |
| `tagNm` | タグ |
| `eventNm` | イベント名 |
| `eventId` | イベントID |
| `awardNm` | 受賞名 |
| `status` | 制作状態 |
| `limit` | 取得件数 |
| `offset` | 取得開始位置 |

ページングには `limit` と `offset` を使用する。

### 3.2 その他のAPI

調査で確認したエンドポイント：

- `GET /material/list`：開発素材一覧の取得
- `POST /event/relation`：作品とイベントの関連登録
- `DELETE /event/relation`：作品とイベントの関連削除

Mashup Oursの初期版では、`GET /prototype/list` を中心に利用する。

## 4. 作品データの構造

取得対象の主なフィールド：

| フィールド | 内容 | Mashup Oursでの用途 |
|---|---|---|
| `id` | 作品ID | 親子関係の識別 |
| `prototypeNm` | 作品名 | 作品選択UI |
| `summary` | 概要 | 生成AIへの入力 |
| `freeComment` | 詳細説明 | 特徴抽出 |
| `systemDescription` | 技術構成 | 技術的な交配 |
| `mainUrl` | メイン画像URL | 作品サムネイル |
| `users` | 作者情報 | クレジット表示 |
| `tags` | タグ | 検索・分類 |
| `licenseType` | ライセンス | 利用可否の判定 |
| `releaseFlg` | 公開状態 | 公開作品の選別 |
| `status` | 制作状態 | 絞り込み |

**注意：** フィールドの型、必須・任意、欠損時の挙動は実際のレスポンスで確認する。説明文にはHTMLやMarkdownが含まれる可能性がある。

## 5. API接続テスト

トークンを取得した後、以下のコマンドで接続を確認する。

```bash
export PROTOPEDIA_API_V2_TOKEN="取得したトークン"

curl -sS --fail-with-body \
  "https://protopedia.net/v2/api/prototype/list?limit=2&offset=0" \
  -H "Authorization: Bearer ${PROTOPEDIA_API_V2_TOKEN}" \
  | jq '.results[] | {
      id,
      prototypeNm,
      summary,
      mainUrl,
      users,
      licenseType
    }'
```

確認項目：

1. HTTPステータスが200であること。
2. JSON形式でレスポンスが返ること。
3. `results` の構造が想定どおりであること。
4. `limit` と `offset` が機能すること。
5. `prototypeId` で特定作品を取得できること。
6. 公開状態・ライセンスの扱いを確認できること。

※上記コードは接続例であり、認証済み実環境での動作検証は未実施。

## 6. Mashup Oursのアーキテクチャ

### 6.1 作品データの同期

```text
ProtoPedia API v2
       |
       | Bearer Token
       v
GitHub Actions
       |
       | 取得・検証・正規化
       v
prototypes.json
       |
       v
GitHub Pages
       |
       +-- 作品検索
       +-- 親作品A・Bの選択
       +-- 元作品情報の表示
```

### 6.2 交配の処理

```text
GitHub Pages
       |
       | 2つの作品ID
       v
GitHub Issue
       |
       | 交配申請
       v
GitHub Actions
       |
       +-- 作品IDの検証
       +-- ProtoPedia情報の取得
       +-- 生成AIへの入力作成
       +-- 新しい発明の生成
       |
       v
breeding.json
       |
       +-- 交配履歴
       +-- 親子関係
       +-- 生成結果
       |
       v
GitHub Pages
       |
       +-- 新発明の表示
       +-- 家系図の更新
```

生成AIによる交配は、サービス全体で最大1時間に1件とする。

## 7. データキャッシュ

GitHub PagesからProtoPedia APIを直接呼び出さず、GitHub Actionsで取得したJSONを読み込む。

### 同期方針

- 初期版は1日1回程度の定期取得を想定。
- ページングで必要な作品を取得する。
- 同期済みデータは検索用JSONに保存する。
- API取得に失敗した場合は直前の正常なJSONを維持する。
- 交配時は作品IDに基づいて元データを検証する。
- 同期時に作品の公開状態や利用条件の変更を考慮する。

### 保存するデータ

- 作品ID
- 作品名
- 作品概要
- 画像URL
- 作者情報
- 元作品URL
- タグ
- 技術情報
- ライセンス情報
- 最終同期日時

詳細説明を無制限に保存せず、用途に応じて必要な項目を選択する。

## 8. 生成AIとの連携

交配では、作品名だけでなく、2作品の特徴を抽出して利用する。

### 親作品A

- 使用技術
- 入力
- 出力
- 仕組み
- 特徴

### 親作品B

- 解決したい課題
- 利用者
- 体験
- ユーモア
- 特徴

これらを生成AIに渡し、新しい発明を生成する。

### 生成結果

- 発明名
- 概要
- 利用シーン
- 技術構成
- 2つの親作品から継承した特徴
- 実現方法

生成結果には両親の作品IDを保存し、発明の家系図へ接続する。

元作品の文章は信頼できない外部入力として扱い、生成AIに対する命令として実行させない。

## 9. セキュリティ

### APIトークン

- GitHub Actions Secretsに保存する。
- GitHub PagesのJavaScriptに埋め込まない。
- JSON、ログ、Issueに出力しない。
- ローカル開発では環境変数から読み込む。

### APIレスポンス

- HTMLを無加工でDOMへ挿入しない。
- MarkdownやHTMLは安全に変換・サニタイズする。
- URLやデータ型を検証する。
- 不正なレスポンスで既存データを上書きしない。

### GitHub Issues

- 投稿された作品IDを検証する。
- Issue本文を信用してAPIトークンや任意のURLへアクセスしない。
- 交配済みIssueを重複処理しない。
- 処理数とAI使用量に上限を設ける。
- Issueの投稿内容をシェルコマンドとして実行しない。

## 10. ライセンスとクレジット

ProtoPediaの作品には利用条件が設定されている。

Mashup Oursでは、元作品を利用する際に以下を守る。

- 利用条件が確認できる作品だけを対象とする。
- 元作品名と作者を表示する。
- ProtoPediaの元作品ページへリンクする。
- AIが生成した新発明を元作品と区別する。
- ライセンス条件に反する画像・説明文の再利用を避ける。

APIで取得可能な作品がCC BYに限定されるかどうかは、実接続と公式条件の照合が必要。

## 11. 制約・未確認事項

| 項目 | 状況 |
|---|---|
| Bearer Token認証 | ドキュメント・実行例で確認 |
| 作品一覧取得 | ドキュメントで確認 |
| ページング | パラメータを確認、実動作は未検証 |
| 作品IDによる絞り込み | パラメータを確認、実動作は未検証 |
| APIレート制限 | 具体的な上限は未確認 |
| CORS | 未検証 |
| CC BY以外の作品の取得 | 要確認 |
| 説明文の文字数上限 | 約2,000文字との利用報告あり、公式上限は未確認 |
| 検索機能の詳細 | 要確認 |
| レスポンスの型・欠損値 | 実測が必要 |

## 12. 実装チェックリスト

- [ ] APIトークンの取得
- [ ] curlによる認証テスト
- [ ] レスポンス構造の確認
- [ ] 作品IDによる取得確認
- [ ] ページング確認
- [ ] 公開状態・ライセンス条件の確認
- [ ] Node.js APIクライアントの実装
- [ ] JSON正規化処理の実装
- [ ] GitHub Actions Secretsの設定
- [ ] 定期同期Workflowの作成
- [ ] GitHub PagesからのJSON読み込み
- [ ] 作品検索・選択UIの接続
- [ ] 交配処理との統合
- [ ] 元作品へのリンク・クレジット表示
- [ ] エラー時のキャッシュ保護
- [ ] APIトークン漏洩防止の確認

## 13. 参考URL

- ProtoPedia API v2公式ドキュメント  
  https://protopediav2.apidog.io/

- ProtoPedia API Ver 2.0（開発素材）  
  https://protopedia.net/material/1863

- ProtoPedia APIの設定  
  https://protopedia.net/settings/application

- ProtoPedia API v2 JavaScriptクライアント  
  https://www.npmjs.com/package/protopedia-api-v2-client

- API活用に関するQiita記事  
  https://qiita.com/n0bisuke/items/79e863d821e4524a8071

---

**本仕様書の位置づけ**

公式ドキュメントおよび公開されている利用例を基に整理した開発用の調査資料。認証済みAPIでの実接続テストは行っていないため、未検証項目は実装時に確認すること。