# Mashup Ours

**20年分の発明を、もう一度マッシュアップ。**

ProtoPediaに公開された実在の作品を2つ「親」として選び、生成AIによって新しい発明のアイデア（「子」）を1つ誕生させるWebサービス。子も次の交配の親になれます。生成された発明の系譜は、公開された「発明の家系図」として育てられます。

> **生成された子作品は「AIが考えた未実装のアイデア」です。** 実際に製作したもの・実在の成果物ではありません。ProtoPediaの元作品には出典リンクを表示します。

## アーキテクチャ

| 部分 | 構成 |
| --- | --- |
| 公開UI | GitHub Pages（Vite + TypeScript の静的サイト） |
| 投稿 | GitHub Issues（サイトにログイン機能・書き込みトークンなし） |
| 交配ワーカー | GitHub Actions（毎時実行 + 手動 `workflow_dispatch`） |
| 永続データ | リポジトリ内の `data/offspring.json` |
| AI | Actions（サーバー側）から呼ぶ交換可能なプロバイダー |

**1時間に1件だけAI交配が走ります（全ユーザー共有の枠）。** 閲覧・選択・家系図表示にAIは使いません。

## セットアップ（ローカル開発）

```bash
cp .env.example .env   # Issue作成リンク用の owner/repo を設定
npm install
npm run dev            # http://localhost:5173
```

- APIキーなしでもフロントは起動・ビルドできます（`npm test`, `npm run build`）。
- ProtoPedia API未接続の現時点では、`[SAMPLE]` 付きの**開発用サンプル作品**のみ表示されます。本番の作品と混同しないでください。
- 開発モードで本番の子作品が0件のときだけ、サンプルの子作品（家系図2世代の確認用）を表示します。

### 環境変数

| 変数 | 用途 | 必須 |
| --- | --- | --- |
| `VITE_GITHUB_OWNER` | Issue作成リンクのowner | ローカルのみ |
| `VITE_GITHUB_REPO` | Issue作成リンクのrepo | ローカルのみ |
| `GITHUB_REPOSITORY` | Actionsが自動提供。ビルド時にクライアントへ注入 | Actions |
| `AI_API_KEY` | 生成AIプロバイダーのキー（**GitHub Secretsのみ**） | 交配処理時 |

## GitHub上の設定（手動）

1. **Pages**: Settings → Pages → Source を `GitHub Actions` に設定（`deploy.yml` が push のたびにテスト → ビルド → デプロイ。base パスと Issue リンクは `GITHUB_REPOSITORY` から自動導出するため、リポジトリをフォークしても再設定不要）。
2. **Issues**: Settings → Issues でラベル `breeding-request` を用意（ワークフロー側で管理。利用者が付ける前提にしない）。
3. **Secrets**: Settings → Secrets and variables → Actions に `AI_API_KEY` を登録（未設定時はドライランのみ）。
4. **Actions権限**: Settings → Actions → General → Workflow permissions を設定。JSONコミットには `contents: write`、Issue対応には `issues: write` を該当ジョブのみに付与。
5. 交配申請はサイトの「交配申請する」ボタン → Issue作成画面が開く → **ユーザー自身が送信**。

## 交配申請フォーマット

```text
Title: [Breed] protopedia:1234 x protopedia:5678   ← 表示用（信用しない）

parent_a: protopedia:1234                           ← 正規の入力元は本文のみ
parent_b: protopedia:5678
mode: fusion
```

- 親Aと親Bは別のID、許可されたID形式（`protopedia:<数字>` / `mashup:<数字>`）のみ。
- 不正な入力はAIを呼ばずに理由をコメントします。

## ID名前空間の決定事項

- ProtoPedia作品: `protopedia:<数字>`（第0世代）
- 生成された子作品: `mashup-<数字6桁>`（例 `mashup-000001`）。**Issue本文の `parent_a` / `parent_b` にもこのid文字列をそのまま使う。**
  - AGENTS.mdのIssue例は `mashup:<生成ID>`（コロン）だが、データモデル例は `mashup-000001`（ハイフン）。**誤導入を避けるためデータモデル例のハイフン形式に統一**した。
- 先祖と子孫の組み合わせ（近親交配）は拒否する。共通の子を持つだけのダイヤモンド形状は許可。

## ステータス / 未検証事項

- [ ] `deploy.yml` の実動作 — **未検証**（ローカルではYAML構文・`GITHUB_REPOSITORY`注入・`npm ci`の整合のみ確認。初回push後のActions実行結果を確認すること）。
- [ ] ProtoPedia APIの公式仕様（認証・レート制限・ライセンス）— **未検証**。実装時に公式資料を確認する。
- [ ] 生成AIプロバイダーの選定（料金・無料枠・構造化出力）— **未検証**。`AI_API_KEY` 未設定時はドライラン。
- [ ] `data/offspring.json` へのコミットとブランチ保護の兼ね合い — Actions実装時に確認、必要ならPR方式へ。

## 開発コマンド

```bash
npm run dev          # 開発サーバー
npm test             # バリデーション・世代計算・循環防止などのテスト
npm run build        # 型チェック + 本番ビルド
npm run validate-data  # data/offspring.json の検証
```

## ディレクトリ

```text
.
├── AGENTS.md            # プロジェクト規約（最初に読む）
├── README.md
├── index.html
├── src/                 # GitHub Pages用UI（vanilla TS）
├── lib/                 # 型・Issueパーサー・世代計算・設定（フロント/ワーカー共有）
├── data/                # offspring.json（本番データ）+ *sample*.json（開発用）
├── scripts/             # ワーカー用スクリプト（validate-data.ts 実装済み、process-breeding.ts 実装予定）
├── tests/
└── .github/workflows/   # deploy.yml（実装済み） / breed.yml（実装予定）
```
