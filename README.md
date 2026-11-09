# Mashup Ours

**20年分の発明を、もう一度マッシュアップ。**

ProtoPediaに公開された実在の作品を2つ「親」として選び、生成AIによって新しい発明のアイデア（「子」）を1つ誕生させるWebサービス。子も次の交配の親になれます。生成された発明の系譜は、公開された「発明の家系図」として育てられます。

> **生成された子作品は「AIが考えた未実装のアイデア」です。** 実際に製作したもの・実在の成果物ではありません。ProtoPediaの元作品には出典リンクを表示します。

## アーキテクチャ

| 部分 | 構成 |
| --- | --- |
| 公開UI | GitHub Pages（Vite + TypeScript の静的サイト） |
| 投稿 | GitHub Issues（サイトにログイン機能・書き込みトークンなし） |
| 交配候補 | 毎時ローテ → `data/current-candidates.json`（**ブラウザはProtoPedia APIを呼ばない**） |
| 作品データ | ProtoPedia API v2 → 少数取得（`data/sample-prototypes.json` ほか）→ 候補プール |
| 交配ワーカー | GitHub Actions（毎時実行 + 手動 `workflow_dispatch`） |
| 永続データ | リポジトリ内の `data/offspring.json` |
| AI | Actions（サーバー側）から呼ぶ交換可能なプロバイダー |

**1時間に1件だけAI交配が走ります（全ユーザー共有の枠）。** 閲覧・選択・家系図表示にAIは使いません。

**候補は毎時6件が全ユーザー共通**です。「本日の発明研究所」に並ぶ候補はスロット（UTC `YYYY-MM-DDTHH`）ごとに決定的に選ばれ、**ページを再読み込みしても変わりません**。自由検索はなく、候補から2作品（AとB）を選んで申請します。

## セットアップ（ローカル開発）

```bash
cp .env.example .env   # Issue作成リンク用の owner/repo を設定
npm install
npm run dev            # http://localhost:5173
```

- APIトークンなしでもフロントは起動・ビルドできます（`npm test`, `npm run build`）。
- 候補6件は `data/current-candidates.json` の静的importだけ（ブラウザからAPIを呼ばない）。
- 候補データが未同期のときは `[SAMPLE]` 付きの**開発用サンプル**が表示され、右上バッジも「開発用サンプル」になります。本番と混同しないでください。
- 本番の子作品が0件のときだけ、サンプルの子作品（家系図2世代の確認用）を「最近誕生した発明」と家系図に表示します（注意書きを分けて案内）。

### 環境変数

| 変数 | 用途 | 必須 |
| --- | --- | --- |
| `VITE_GITHUB_OWNER` | Issue作成リンクのowner | ローカルのみ |
| `VITE_GITHUB_REPO` | Issue作成リンクのrepo | ローカルのみ |
| `GITHUB_REPOSITORY` | Actionsが自動提供。ビルド時にクライアントへ注入 | Actions |
| `AI_API_KEY` | 生成AIプロバイダーのキー（**GitHub Secretsのみ**） | 交配処理時 |
| `PROTOPEDIA_API_V2_TOKEN` | ProtoPedia API v2のトークン（**GitHub Secrets / ローカルenvのみ。VITE_ プレフィックス禁止**） | 作品同期時 |
| `GH_TOKEN` | ローカルの `gh` CLI用PAT（`.env` 専用・`node scripts/gh.mjs` が読む。**VITE_ プレフィックス禁止**。Actionsは `GITHUB_TOKEN` で自動認証） | 開発issue登録時のみ |

## GitHub上の設定（手動）

1. **Pages**: Settings → Pages → Source を `GitHub Actions` に設定（`deploy.yml` が push のたびにテスト → ビルド → デプロイ）。**base は既定で相対パス（`./`）**: カスタムドメインのルート配信・`<owner>.github.io/<repo>/`・フォーク先のいずれでも、ドメインや公開パスを変更してもビルド設定なしで動く（Issue リンクは `GITHUB_REPOSITORY` から自動導出）。絶対パスに固定したい場合のみ `VITE_BASE=/<repo>/` を指定する。絶対パス base をカスタムドメインで使うとアセットが全部404で真っ黒になる（実例: 2026-11-10 → 相対baseへ修正）。
2. **Issues**: Settings → Issues でラベル `breeding-request` を用意（ワークフロー側で管理。利用者が付ける前提にしない）。
3. **Secrets**: Settings → Secrets and variables → Actions に登録:
   - `AI_API_KEY`（交配処理。未設定時はドライランのみ）
   - `PROTOPEDIA_API_V2_TOKEN`（作品同期。[トークン取得先](https://protopedia.net/settings/application)。未設定時は同期をスキップし既存データを維持）
4. **Actions権限**: Settings → Actions → General → Workflow permissions を設定。JSONコミットには `contents: write`、Issue対応には `issues: write` を該当ジョブのみに付与。
5. 交配申請はサイトの「交配を申請」ボタン → Issue作成画面が開く → **ユーザー自身が送信**。

## ProtoPedia作品の取得と候補ローテ（API v2）

仕様は `docs/protopediaapi.md`（調査資料。**実接続で一部確認済み**、下「検証済みと未検証」参照）。実装は `lib/protopedia.ts` + `scripts/fetch-sample-prototypes.mjs` + `scripts/rotate-candidates.ts`。

```text
ProtoPedia API v2 ──(Bearer)──> npm run fetch:sample（少数・手動 / syncはdispatchのみ）
                                   │ 取得 → HTML除去・型検証・URL検証・ライセンス確認
                                   ▼
                          data/sample-prototypes.json（候補プール）
                                   │ npm run rotate:candidates（毎時・API/トークン不要）
                                   ▼
                          data/current-candidates.json ──> GitHub Pages（静的import）
```

- **試作段階では全件収集を開始しない**: `npm run fetch:sample` は既定12件（`--count=` 上限50 / `--offset=`）。
  全件同期は `npm run sync:protopedia`。`sync-prototypes.yml` は**手動 dispatch のみ**（有効化するときだけ `schedule` を戻す）。
- **候補ローテ**: `npm run rotate:candidates` は保存済みプールからスロット（UTC `YYYY-MM-DDTHH`）に**決定的に**6件を選出。
  同じスロットなら常に同じ6件（Actionsの再実行・ローカル実行でも不変）。APIもトークンも使わない。
  `-- --slot=2026-11-09T14` で任意の枠を検証、`-- --dry-run` で書き込まず確認。
- **毎時更新**: `.github/workflows/rotate-candidates.yml`（cron + dispatch）がスロットを進めて `data/current-candidates.json` をコミット。
  画面上の「次回の候補更新予定」はこの**実行結果（JSONの値）**ベースで、Actionsの遅延時は注意書きが出ます。
- **失敗時の挙動**: 取得失敗・0件・不正レスポンスでは既存JSONを置き換えない（0件保存は拒否）。
- **トークンの扱い**: `.env` / Secretsのみ。スクリプトがreadFileSyncで読む（シェルにexportしない）。ログ・JSON・コミット・フロントバンドルに入れない。
- 作者（`表示名@handle` のまま保存 = クレジット用）・タグ・ライセンス・作品画像はこのJSONから表示。

## 交配申請フォーマット

```text
Title: [Breed] protopedia:1234 x protopedia:5678   ← 表示用（信用しない）

parent_a: protopedia:1234                           ← 正規の入力元は本文のみ
parent_b: protopedia:5678
parent_a_url: https://protopedia.net/prototype/1234 ← 表示・照合用の「データ」（httpsのみ）
parent_b_url: https://protopedia.net/prototype/5678
mode: fusion
slot: 2026-11-09T12                                 ← 申請時の候補スロット（UTC）
<!-- 任意: comment: の後に1行だけで自由記述（最大300字・交配の動機など） -->
```

- 親Aと親Bは別のID、許可されたID形式（`protopedia:<数字>` / `mashup-<数字>`）のみ。
- `slot` / `*_url` は付いていれば形式を検証して記録。URLは命令として扱わず、ワーカーは親IDから出典URLを再導出する。
- `comment` は任意の自由記述（1行・最大300字）。**データとして保持するだけで、シェル・Actions式・AIプロンプトには渡しません**（issue #7）。
- 不正な入力はAIを呼ばずに理由をコメントします。

## デザイン（16bit交配研究所 / DESIGN.md準拠）

デザインの基準は `DESIGN.md`。「ちょっと怪しい発明博士の、16bit交配研究所」。MOTHER2/マサキの家の雰囲気を**抽象化して独自に**構成し、既存IPの画像・キャラクター・UI配置は流用しない。

- **ダーク / ライト切り替え**: ヘッダー右上のボタンで切り替え、`localStorage['mashup-theme']` に保存。既定はOS設定。`index.html` の初期化スクリプトがCSS読込前に `data-theme` を設定し、テーマフラッシュを防ぐ。トークンは `:root` の `--lab-*`（固定パレット）とロールトークン（`--bg` / `--window` / `--line` / `--text` など）に集中管理。
- **フォント**: 見出し・ボタン・ラベルは [DotGothic16](https://fonts.google.com/specimen/DotGothic16)、**本文は [Noto Sans JP](https://fonts.google.com/specimen/Noto+Sans+JP)** で可読性優先（**Google Fonts CDN への外部接続あり**。届かない環境ではゴシック/等幅にフォールバック）。
- **アクセス解析**: **Google Tag Manager（`GTM-NLGLRR3T`）** をトップと `/ideas` の両方の `<head>` に配置し、`<body>` 直後に公式推奨の `noscript` iframe を配置（**外部接続先: `googletagmanager.com`**）。タグ本体はGTMコンテナ側で管理し、サイトにはIDだけを置く。ローカルの `npm run dev` / preview からもヒットが送信される（解析値に開発データが混ざる点に注意。除外はGTMコンテナ側のトリガー条件で行う）。
- **ウィンドウ**: 太い外枠3px + 内側の細い線（inset）+ 右下ハードシャドウのRPG風。ガラス調・ネオンは不使用。
- **候補パネル「本日の発明研究所」**: 画面完成イメージ準拠の角丸パネル + 3列画像カード（900pxで2列 / 560pxで1列）。
  画像タイルは下地 `--tile`（白系・両テーマ共通）で `object-fit: contain`・`loading=lazy`・読込失敗時は「画像なし」プレースホルダ（枠は維持）。
  見出しは DotGothic16 + ラテン小見出し、枠・色は研究所トークンのまま — **一般的なSaaSカードUIにしない**。
  選択状態は「タイル枠の色 + バッジ文字（親A選択中）+ 押下ボタン」の三重化で色だけに依存しない。
- **一覧ページ `/ideas`**: Viteマルチページ（`public/ideas/index.html` + `public/ideas.ts`）。`data/offspring.json` のみを新しい順に列挙し、各項目に 未実装バッジ・世代・親リンク（子作品=トップの `?id=` ディープリンク / ProtoPedia=出典URL）・生成日時（JST）・元Issue（あれば）を表示。0件なら空状態で申請誘導。トップの「最近誕生した発明」見出しからリンクする。
- **家系図の配色は dataviz 手順で検証済み（両テーマ・ノード面でPASS）**:
  | テーマ | 面 | 元作品（実線） | 子作品（破線） |
  |---|---|---|---|
  | ダーク | `#303C51` | `#12A87D` | `#D96B4F` |
  | ライト | `#FFFCF0` | `#0F9D72` | `#C15733` |

  CVD分離は ΔE 7〜8 のWARN帯のため、**凡例 + 線種（実線/破線）+ ノードラベルで二重化**して合法化している。勝手に色を替えない。
- **コントラスト**: 本文はAA（4.5:1以上）をトークンで確保。アクセント色の強調語は `--accent-ink`（通常サイズでAA）、タグラインは太字19pxの「大きな文字」経路（3:1以上）を使う。装飾は `aria-hidden`、状態は色のみで区別しない（ラベル・線種・マーク併用）。
- **装飾**: 浮遊スプライト・常時点滅・グリッド背景は不使用（DESIGN.md §3.1/§6）。所長のメモは文字だけのセリフウィンドウ。**博士キャラクターは状態表現としてのみ動き、`prefers-reduced-motion` で全停止する。**
- **博士キャラクター（issue #11）**: 伴野博士（案内・親選択）と ひげだるま博士（交配実験・結果発表）を8bitスプライトで表示（`public/assets/characters/` に個別透過PNG 8枚・共通135×268・足元揃え、切り出しは `scripts/slice-characters.mjs`）。
  - 状態は `idle / success / thinking / celebration` の4種（`public/character.ts` が表示、`public/breeding-state.ts` が実際の状態から決定）。
  - **リアクションは実際の処理状態と連動**: Issue作成画面を開いただけでは `success` にしない（「送信」まで未完了と表示）。申請完了は匿名GitHub APIがIssueを確認したときだけ。**実験待ち（open Issue）と生成中（closed 未公開）を区別**し、誕生（`celebration`）は公開済みの本番子作品でだけ判定する。
  - 状態観測はブラウザから匿名 `api.github.com`（CORS可・60req/h/IP）を **3分間隔（最大40req/h）** でポーリング。3回連続失敗・レート制限・誕生確認で停止し、無限リトライしない（`public/github-watch.ts`）。
  - ランタイムの誕生検知用にビルド時と同様の `data/offspring.json` を `dist/` へ emit（取得失敗時はビルド時データにフォールバック）。
- **スクリーンショット確認**: `npm run build && npx vite preview --port 4173` を起動してから `npm run screenshot`（**ライト/ダーク両テーマ** × デスクトップ/詳細/モバイルを `tmp/` に出力。初回のみ `npx playwright install chromium` と `install-deps` が必要）。

## ID名前空間の決定事項

- ProtoPedia作品: `protopedia:<数字>`（第0世代）
- 生成された子作品: `mashup-<数字6桁>`（例 `mashup-000001`）。**Issue本文の `parent_a` / `parent_b` にもこのid文字列をそのまま使う。**
  - AGENTS.mdのIssue例は `mashup:<生成ID>`（コロン）だが、データモデル例は `mashup-000001`（ハイフン）。**誤導入を避けるためデータモデル例のハイフン形式に統一**した。
- 先祖と子孫の組み合わせ（近親交配）は拒否する。共通の子を持つだけのダイヤモンド形状は許可。

## ステータス / 検証済みと未検証

**実接続で確認済み（2026-11・実トークンでの取得）**:
- `/prototype/list` のレスポンス形状は `{metadata, count, links, results}`。**`count` はページ内件数**（総数ではない）。
- カタログ件数外の offset は HTTP 200 + `count:0` で `results` キー自体が無い（= 空ページとして正常終了）。
- `users` / `tags` は `|`-区切りの**文字列**。作者は `表示名@handle` 形式（例 `ひさやん@hisayan`。そのまま保存 = クレジット用）。
- `licenseType: 1` → 作品ページ表示「CC BY 4+」（id=1 のページと照合済み）。取得時はライセンスのある作品だけ保存。
- 作品ページURLは `https://protopedia.net/prototype/<id>`。カタログ総数は 5,100件超（正確な総数は未測定）。
- `data/sample-prototypes.json` 12件取得 → `data/current-candidates.json` 候補6件生成 → 両方とも `npm run validate-data` で検証済み。

**未検証**:
- [ ] `deploy.yml` / `sync-prototypes.yml` / `rotate-candidates.yml` の実動作 — push後のActions実行結果で確認（ローカルではYAML構文・スクリプト単体・決定的選出テストのみ確認）。
- [ ] `releaseFlg` のenum値の意味（観測値は常に 2。欠損=公開扱いの暫定実装）。
- [ ] ProtoPedia APIのレート制限・1レスポンスの件数上限（ページ間隔100msで暫定対応）。
- [ ] 生成AIプロバイダーの選定（料金・無料枠・構造化出力）。`AI_API_KEY` 未設定時はドライラン。
- [ ] `data/offspring.json` へのコミットとブランチ保護の兼ね合い — Actions実装時に確認、必要ならPR方式へ。
- [ ] GitHub Pages 本番での `/ideas` 配信 — ローカル preview では `/`・`/ideas/`・`/ideas` すべて200を確認。Pagesの `/ideas` → `/ideas/` リダイレクト挙動は未検証（自前リンクは末尾 `/` つきなので影響なし）。
- [ ] ブラウザからの匿名 GitHub API ポーリング（申請確認・実験待ち/生成中/誕生の観測）の実挙動 — ローカルではフェッチ注入の単体テストのみ。実ネットワークでのレート制限・CORS挙動は未検証。
- [ ] Pages 本番での `dist/data/offspring.json` 配信（誕生のランタイム検知）— ローカル preview/dev では 200 を確認済み。

## 開発コマンド

```bash
npm run dev             # 開発サーバー
npm test                # パーサー・世代計算・候補選出・フロントのスモークテスト
npm run build           # 型チェック + 本番ビルド
npm run validate-data   # offspring / prototypes / sample-prototypes / current-candidates の検証
npm run fetch:sample    # ProtoPediaから少数だけ取得 → data/sample-prototypes.json（トークン要）
npm run rotate:candidates # 候補6件をスロットから決定的に選出 → data/current-candidates.json（トークン不要）
npm run screenshot      # 両テーマ×デスクトップ/詳細/モバイル + /ideas一覧のスクリーンショット（tmp/）
```

## ディレクトリ

```text
.
├── AGENTS.md            # プロジェクト規約（最初に読む）
├── DESIGN.md            # デザイン規約（16bit交配研究所）
├── README.md
├── public/              # 公開サイト一式（Viteのroot。ページ・UI・静的ファイル）
│   ├── index.html       # / トップ（交配研究所）
│   ├── main.ts          # トップのUI（vanilla TS）
│   ├── character.ts     # 博士キャラクター表示（状態・スプライト・読み上げ制御）
│   ├── breeding-state.ts # 交配状態判定（申請確認/実験待ち/生成中/誕生の純関数）
│   ├── github-watch.ts  # 匿名GitHub APIポーリング（上限・停止条件つき）
│   ├── ideas.ts         # /ideas 一覧ページのUI
│   ├── ideas/           # /ideas アイデア一覧（マルチページエントリ）
│   ├── style.css        # 16bit 交配研究所テーマ
│   ├── assets/          # ビルド取り込み対象（博士スプライト8枚 透過PNG 135×268）
│   └── static/          # そのまま配信する生ファイル（dist直下へコピー）
│       └── sprites/     # ピクセル絵素材の原本（切り出し元）
├── lib/                 # 型・Issueパーサー・世代計算・候補選出・ProtoPedia/設定（フロント/ワーカー共有）
├── data/                # offspring.json / current-candidates.json / *sample*.json
├── logs/                # 開発ログ（public公開のため秘密情報は書かない / 書式は logs/README.md）
├── scripts/             # fetch-sample / rotate-candidates / sync / validate-data / screenshot / gh / slice-characters（博士スプライト切り出し）
├── tests/
└── .github/workflows/   # deploy.yml / sync-prototypes.yml（dispatchのみ） /
                         # rotate-candidates.yml（毎時） / breed.yml（実装予定）
```
