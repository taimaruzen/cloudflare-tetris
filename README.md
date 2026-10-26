# NEON DROP — Cloudflare で動くオンライン落ち物パズル

ブラウザで遊べる、ネオン調デザインの落ち物パズルゲームです。
フロントエンドと API を Cloudflare Workers 1つで配信し、ランキングは Cloudflare D1 に保存します。
ランキングへの不正なスコア送信を防ぐため、**サーバー側でプレイ内容（リプレイ）を最初から再生してスコアを再計算**します。

> 本作は「テトリス」とは無関係のオリジナル作品です。既存ゲームのロゴ・画像・音源は一切使用していません（効果音は Web Audio でその場で合成）。

## 主な機能

| 分類 | 内容 |
| --- | --- |
| ゲーム | 10×20 フィールド / 7種のブロック / 7-bag 抽選 / SRS 回転（壁蹴り込み） / ソフト・ハードドロップ / ホールド / NEXT 5個 / ゴースト / ライン消去アニメーション / レベルアップで加速 / 一時停止・リトライ |
| 得点 | 1〜4ライン：100・300・500・800 × レベル、連続4ライン（Back-to-Back）1.5倍、コンボ 50 × コンボ数 × レベル、ソフトドロップ 1点/マス、ハードドロップ 2点/マス |
| 操作（PC） | ← → 移動、↑ / X 右回転、Z 左回転、↓ 高速落下、Space ハードドロップ、C ホールド、P / Esc 一時停止、Enter / R リトライ |
| 操作（スマホ） | 画面下のボタン（長押しで連続移動）、フィールドの横スワイプで移動、下ドラッグで高速落下、下フリックでハードドロップ、上フリックでホールド、タップで回転 |
| オンライン | ログイン不要。ニックネーム登録でランキング参加（全期間・週間・日間・自己ベスト） |
| 不正対策 | サーバー発行シード＋リプレイ再計算、実時間チェック、使い捨てセッション、トークン認証、レート制限、任意で Turnstile |

## 技術構成

- **React + TypeScript + Vite + Tailwind CSS**：フロントエンド
- **Cloudflare Workers**：Static Assets でフロントを配信し、`/api/*` だけ Worker で処理（`run_worker_first`）
- **Cloudflare D1**：プレイヤー・ゲーム記録・セッション・自己ベスト
- **Workers Rate Limiting**：API のレート制限（無料プランで利用可）
- **Cron Trigger**：期限切れセッションの定期削除
- **Cloudflare Turnstile**：任意（サイトキーとシークレットを設定したときだけ有効）
- **Wrangler / Workers Builds**：デプロイと GitHub 連携の自動デプロイ

KV は使っていません。ランキングは D1 の索引と集計表（`player_best`）で十分速く、KV の無料枠（書き込み 1,000回/日）をキャッシュに使うと逆に上限に当たりやすいためです。

```
.
├── index.html
├── migrations/0001_init.sql      D1 のスキーマ
├── public/                       favicon・_headers（CSP などのセキュリティヘッダー）
├── src/
│   ├── engine/                   ゲームエンジン（クライアントとサーバーで共有）
│   │   ├── constants.ts          ルール定数・重力表（整数のみ）
│   │   ├── pieces.ts             ブロック形状・SRS 壁蹴りテーブル
│   │   ├── rng.ts                シード付き乱数・7-bag
│   │   ├── game.ts               本体（1ティック = 1/60 秒の決定的シミュレーション）
│   │   └── replay.ts             リプレイ記録とサーバー側検証
│   ├── client/                   React UI（Canvas 描画・入力・効果音）
│   ├── worker/                   Workers API
│   └── shared/api-types.ts       API の型
├── tests/                        自動テスト（node:test）
├── wrangler.jsonc
└── vite.config.ts
```

## 不正スコア対策の仕組み

クライアントが「スコアは 999,999 点」と送ってきても信用しません。

1. **ゲーム開始時**に `POST /api/games` でサーバーがランダムなシードとセッション ID を発行し、D1 に保存します。
2. ブロックの出る順番はそのシードで決まります。クライアントは**ティック番号と入力（左・回転・ハードドロップなど）だけ**を記録します。
3. **ゲームオーバー後**に `POST /api/scores` で入力列を送ると、サーバーが同じエンジンで最初から再生し、スコア・ライン数・レベルを**再計算した値だけ**を保存します。
4. さらに次のチェックを行います。
   - セッションは本人のもので、未使用・発行から 6 時間以内であること（使い回し・総当たり防止のため、検証前に使用済みにする）
   - ゲーム内時間が実際の経過時間を超えていないこと（加速ツール対策）
   - 1ティックあたりの入力数・総入力数・最大プレイ時間の上限
   - 本当にゲームオーバーで終わっていること
5. エンジンは浮動小数点を使わず整数演算だけで動くため、ブラウザと Workers で必ず同じ結果になります。入力のない区間はまとめて計算するので、検証は通常数ミリ秒で終わります。

なお、この方式でも「人間より上手い自動操作プログラム」は原理的に防げません。必要に応じて Turnstile を有効にしてください。

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/health` | 稼働状況（D1 接続）と Turnstile のサイトキー |
| GET | `/api/rankings?limit=50` | 全期間ランキング（1人1行、自己ベスト順） |
| GET | `/api/rankings/daily` | 日間ランキング（UTC 0時起点） |
| GET | `/api/rankings/weekly` | 週間ランキング（UTC 月曜0時起点） |
| GET | `/api/players/:id` | プレイヤーの公開情報・自己ベストと順位・直近10件 |
| POST | `/api/players` | ニックネーム登録 `{ nickname, turnstileToken? }` → `{ player, token }` |
| POST | `/api/games` | ゲーム開始（要 `Authorization: Bearer <token>`）→ `{ sessionId, seed }` |
| POST | `/api/scores` | スコア送信（要トークン）`{ sessionId, replay: { inputs, ticks }, claimed }` |

- エラーは `{ "error": { "code": "...", "message": "..." } }` の形で返します。
- 書き込み系は `Content-Type: application/json` 必須、別オリジンからの送信は拒否（CSRF 対策）。
- レート制限：読み取り 120回/分/IP、書き込み 30回/分（プレイヤー・IP 単位）、登録 5回/分/IP。超えると `429`。
- トークンは `プレイヤーID.秘密値` の形で、D1 には秘密値の SHA-256 だけを保存します。

## 開発

```bash
npm install
npm run db:migrate:local   # ローカルの D1 にテーブルを作成
npm run dev                # Vite + Workers ランタイムで起動
npm test                   # 自動テスト
npm run typecheck          # 型チェック
```

テストは Node 標準のテストランナーで動き、API のテストは Node 組み込みの SQLite で D1 を再現して Worker のコードをそのまま実行します。

## デプロイ

### 初回（手元から）

```bash
npx wrangler login
npx wrangler d1 create cloudflare-tetris-db       # 作成済みの場合は不要。表示された ID を wrangler.jsonc に設定
npm run deploy                                   # ビルド → マイグレーション → デプロイ
```

### GitHub 連携の自動デプロイ（Workers Builds）

Cloudflare ダッシュボード → **Workers & Pages** → `cloudflare-tetris` → **Settings** → **Builds** → **Connect** で、
このリポジトリと `main` ブランチを接続します。

- Build command：`npm run build`
- Deploy command：`npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`

以降は `main` に push するたびに自動でデプロイされます。

### Turnstile を有効にする（任意）

1. ダッシュボードで Turnstile のウィジェットを作成
2. `wrangler.jsonc` の `vars.TURNSTILE_SITE_KEY` にサイトキーを設定
3. `npx wrangler secret put TURNSTILE_SECRET_KEY` でシークレットを登録

シークレットや API トークンはリポジトリに含めないでください（`.dev.vars` は `.gitignore` 済み）。

## 無料枠について

- Workers：1日 10万リクエスト、CPU 10ms/リクエスト。静的アセットの配信は無料・無制限
- D1：読み取り 500万行/日、書き込み 10万行/日、5GB
- スコア検証の CPU 時間は通常のゲームで数ミリ秒です。ただし上級者の長いゲーム（数百ライン・入力数千件）では、無料プランの上限 10ms を超えて送信が失敗する可能性があります（受け付ける上限は最大 2時間・入力 6万件）。

## ライセンス

MIT
