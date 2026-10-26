export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 読み取り API 用（IP 単位） */
  RL_READ?: RateLimit;
  /** 書き込み API 用（IP / プレイヤー単位） */
  RL_WRITE?: RateLimit;
  /** プレイヤー作成用（IP 単位、厳しめ） */
  RL_SIGNUP?: RateLimit;
  /** Turnstile を使う場合のみ設定（サイトキーは公開値、シークレットは wrangler secret で設定） */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
