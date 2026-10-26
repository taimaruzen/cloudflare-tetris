-- オンラインテトリス風ゲーム 初期スキーマ
-- 時刻はすべて UNIX エポックのミリ秒（INTEGER）

-- プレイヤー（ログイン不要。ニックネームと秘密トークンで識別）
CREATE TABLE IF NOT EXISTS players (
  id              TEXT PRIMARY KEY,                 -- UUID
  nickname        TEXT NOT NULL,
  token_hash      TEXT NOT NULL,                    -- 秘密トークンの SHA-256（平文は保存しない）
  created_at      INTEGER NOT NULL,
  last_played_at  INTEGER
);

-- ゲームセッション（サーバーが発行するシード。1回だけスコア送信に使える）
CREATE TABLE IF NOT EXISTS game_sessions (
  id          TEXT PRIMARY KEY,                     -- UUID
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seed        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  used_at     INTEGER                               -- スコア送信に使われた時刻（NULL = 未使用）
);
CREATE INDEX IF NOT EXISTS idx_sessions_player_created ON game_sessions (player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON game_sessions (created_at);

-- ゲーム記録（サーバー側でリプレイを再計算した値のみ保存）
CREATE TABLE IF NOT EXISTS games (
  id           TEXT PRIMARY KEY,                    -- UUID
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL UNIQUE REFERENCES game_sessions(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  lines        INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  pieces       INTEGER NOT NULL,
  ticks        INTEGER NOT NULL,                    -- ゲーム内ティック数（60 = 1秒）
  duration_ms  INTEGER NOT NULL,                    -- プレイ時間
  played_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_played_score ON games (played_at, score DESC);
CREATE INDEX IF NOT EXISTS idx_games_player_score ON games (player_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_games_player_played ON games (player_id, played_at DESC);

-- プレイヤーごとの自己ベスト（全期間ランキングを全件走査せずに出すための集計表）
CREATE TABLE IF NOT EXISTS player_best (
  player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  lines       INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_best_score ON player_best (score DESC, achieved_at ASC);
