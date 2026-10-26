/** クライアントとサーバーで共有する API の型 */

export interface PlayerPublic {
  id: string;
  nickname: string;
  createdAt: number;
  lastPlayedAt: number | null;
}

export interface RankingEntry {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
  lines: number;
  level: number;
  achievedAt: number;
}

export type RankingPeriod = 'all' | 'weekly' | 'daily';

export interface RankingResponse {
  period: RankingPeriod;
  /** 集計期間の開始（UTC、ミリ秒）。全期間は null */
  since: number | null;
  entries: RankingEntry[];
}

export interface GameRecord {
  id: string;
  score: number;
  lines: number;
  level: number;
  durationMs: number;
  playedAt: number;
}

export interface PlayerProfileResponse {
  player: PlayerPublic;
  best: (GameRecord & { rank: number }) | null;
  recent: GameRecord[];
  totalGames: number;
}

export interface CreatePlayerRequest {
  nickname: string;
  turnstileToken?: string;
}

export interface CreatePlayerResponse {
  player: PlayerPublic;
  /** "<playerId>.<secret>" 形式。ブラウザに保存し、以降の送信で Bearer として使う */
  token: string;
}

export interface StartGameResponse {
  sessionId: string;
  seed: string;
}

export interface SubmitScoreRequest {
  sessionId: string;
  replay: { inputs: number[]; ticks: number };
  /** クライアント側の結果（参考値。保存されるのはサーバーの再計算結果） */
  claimed: { score: number; lines: number; level: number };
}

export interface SubmitScoreResponse {
  game: GameRecord;
  personalBest: boolean;
  /** 全期間ランキングでの自己ベストの順位 */
  rank: number;
}

export interface HealthResponse {
  ok: boolean;
  time: number;
  database: 'ok' | 'error';
  turnstileSiteKey: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
