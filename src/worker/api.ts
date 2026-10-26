import { TICK_RATE, verifyReplay } from '../engine';
import type {
  CreatePlayerResponse,
  GameRecord,
  HealthResponse,
  PlayerProfileResponse,
  PlayerPublic,
  RankingEntry,
  RankingPeriod,
  RankingResponse,
  StartGameResponse,
  SubmitScoreResponse,
} from '../shared/api-types';
import { randomHex, sha256Hex, timingSafeEqual } from './crypto';
import type { Env } from './env';
import { HttpError, assertSameOrigin, json, readJson } from './http';
import { clientIp, enforceRateLimit } from './ratelimit';
import { isUuid, normalizeNickname, parseLimit, requireInt, requireObject, requireUuid } from './validation';

/** 1ゲームの最大時間（2時間） */
export const MAX_GAME_TICKS = 2 * 60 * 60 * TICK_RATE;
/** 1ゲームの最大入力数 */
export const MAX_REPLAY_INPUTS = 60_000;
/** スコア送信の本文上限 */
const MAX_SCORE_BODY = 1_200_000;
/** セッションの有効期限（6時間） */
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
/** 実時間より速くゲームが進んでいないかの許容誤差 */
const REALTIME_TOLERANCE_MS = 3000;

type Handler = (req: Request, env: Env, url: URL, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)')) + '/?$',
  );
  routes.push({ method, pattern, keys, handler });
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let methodMismatch = false;
  for (const r of routes) {
    const m = r.pattern.exec(url.pathname);
    if (!m) continue;
    if (r.method !== request.method && !(r.method === 'GET' && request.method === 'HEAD')) {
      methodMismatch = true;
      continue;
    }
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    if (request.method === 'GET' || request.method === 'HEAD') {
      await enforceRateLimit(env.RL_READ, 'read', clientIp(request));
    } else {
      assertSameOrigin(request);
    }
    return r.handler(request, env, url, params);
  }
  if (methodMismatch) throw new HttpError(405, 'method_not_allowed', 'このメソッドは使えません');
  throw new HttpError(404, 'not_found', 'API が見つかりません');
}

// ---------------------------------------------------------------- 認証

interface PlayerRow {
  id: string;
  nickname: string;
  token_hash: string;
  created_at: number;
  last_played_at: number | null;
}

function toPublic(p: PlayerRow): PlayerPublic {
  return { id: p.id, nickname: p.nickname, createdAt: p.created_at, lastPlayedAt: p.last_played_at };
}

/** Authorization: Bearer <playerId>.<secret> を検証してプレイヤーを返す */
async function authenticate(request: Request, env: Env): Promise<PlayerRow> {
  const header = request.headers.get('Authorization') ?? '';
  const m = /^Bearer ([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(header);
  if (!m || !isUuid(m[1])) throw new HttpError(401, 'unauthorized', 'プレイヤー登録が必要です');
  const player = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(m[1]).first<PlayerRow>();
  const hash = await sha256Hex(m[2]!);
  if (!player || !timingSafeEqual(hash, player.token_hash)) {
    throw new HttpError(401, 'unauthorized', 'プレイヤー情報が正しくありません');
  }
  return player;
}

async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new HttpError(400, 'turnstile_required', 'ボット確認を完了してください');
  }
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) throw new HttpError(403, 'turnstile_failed', 'ボット確認に失敗しました');
}

// ---------------------------------------------------------------- ヘルスチェック

route('GET', '/api/health', async (_req, env) => {
  let database: HealthResponse['database'] = 'ok';
  try {
    await env.DB.prepare('SELECT 1').first();
  } catch {
    database = 'error';
  }
  const body: HealthResponse = {
    ok: database === 'ok',
    time: Date.now(),
    database,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  };
  return json(body, { status: body.ok ? 200 : 503 });
});

// ---------------------------------------------------------------- ランキング

/** UTC の今日 0時 / 今週月曜 0時 */
export function periodStart(period: RankingPeriod, now = Date.now()): number | null {
  if (period === 'all') return null;
  const d = new Date(now);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (period === 'daily') return dayStart;
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return dayStart - daysSinceMonday * 86_400_000;
}

interface RankingRow {
  player_id: string;
  nickname: string;
  score: number;
  lines: number;
  level: number;
  achieved_at: number;
}

async function getRanking(env: Env, period: RankingPeriod, limit: number): Promise<RankingResponse> {
  const since = periodStart(period);
  let rows: RankingRow[];
  if (since === null) {
    rows = (
      await env.DB.prepare(
        `SELECT b.player_id, p.nickname, b.score, b.lines, b.level, b.achieved_at
           FROM player_best b JOIN players p ON p.id = b.player_id
          ORDER BY b.score DESC, b.achieved_at ASC
          LIMIT ?`,
      )
        .bind(limit)
        .all<RankingRow>()
    ).results;
  } else {
    rows = (
      await env.DB.prepare(
        `WITH ranked AS (
           SELECT player_id, score, lines, level, played_at AS achieved_at,
                  ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, played_at ASC) AS rn
             FROM games
            WHERE played_at >= ?
         )
         SELECT r.player_id, p.nickname, r.score, r.lines, r.level, r.achieved_at
           FROM ranked r JOIN players p ON p.id = r.player_id
          WHERE r.rn = 1
          ORDER BY r.score DESC, r.achieved_at ASC
          LIMIT ?`,
      )
        .bind(since, limit)
        .all<RankingRow>()
    ).results;
  }
  const entries: RankingEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.player_id,
    nickname: r.nickname,
    score: r.score,
    lines: r.lines,
    level: r.level,
    achievedAt: r.achieved_at,
  }));
  return { period, since, entries };
}

route('GET', '/api/rankings', async (_req, env, url) => json(await getRanking(env, 'all', parseLimit(url))));
route('GET', '/api/rankings/daily', async (_req, env, url) =>
  json(await getRanking(env, 'daily', parseLimit(url))),
);
route('GET', '/api/rankings/weekly', async (_req, env, url) =>
  json(await getRanking(env, 'weekly', parseLimit(url))),
);

// ---------------------------------------------------------------- プレイヤー

interface GameRow {
  id: string;
  score: number;
  lines: number;
  level: number;
  duration_ms: number;
  played_at: number;
}

function toRecord(g: GameRow): GameRecord {
  return { id: g.id, score: g.score, lines: g.lines, level: g.level, durationMs: g.duration_ms, playedAt: g.played_at };
}

async function allTimeRank(env: Env, score: number, achievedAt: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM player_best WHERE score > ?1 OR (score = ?1 AND achieved_at < ?2)',
  )
    .bind(score, achievedAt)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

route('GET', '/api/players/:id', async (_req, env, _url, params) => {
  const id = requireUuid(params.id, 'id');
  const player = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first<PlayerRow>();
  if (!player) throw new HttpError(404, 'player_not_found', 'プレイヤーが見つかりません');

  const [bestRes, recentRes, countRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT g.id, g.score, g.lines, g.level, g.duration_ms, g.played_at
         FROM player_best b JOIN games g ON g.id = b.game_id WHERE b.player_id = ?`,
    ).bind(id),
    env.DB.prepare(
      `SELECT id, score, lines, level, duration_ms, played_at FROM games
        WHERE player_id = ? ORDER BY played_at DESC LIMIT 10`,
    ).bind(id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM games WHERE player_id = ?').bind(id),
  ]);
  const bestRow = (bestRes!.results as GameRow[])[0];
  const body: PlayerProfileResponse = {
    player: toPublic(player),
    best: bestRow ? { ...toRecord(bestRow), rank: await allTimeRank(env, bestRow.score, bestRow.played_at) } : null,
    recent: (recentRes!.results as GameRow[]).map(toRecord),
    totalGames: (countRes!.results as { n: number }[])[0]?.n ?? 0,
  };
  return json(body);
});

route('POST', '/api/players', async (req, env) => {
  const ip = clientIp(req);
  await enforceRateLimit(env.RL_SIGNUP, 'signup', ip);
  const body = requireObject(await readJson(req, 4096));
  const nickname = normalizeNickname(body.nickname);
  await verifyTurnstile(env, body.turnstileToken, ip);

  const id = crypto.randomUUID();
  const secret = randomHex(32);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO players (id, nickname, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, nickname, await sha256Hex(secret), now)
    .run();
  const res: CreatePlayerResponse = {
    player: { id, nickname, createdAt: now, lastPlayedAt: null },
    token: `${id}.${secret}`,
  };
  return json(res, { status: 201 });
});

// ---------------------------------------------------------------- ゲーム開始・スコア送信

route('POST', '/api/games', async (req, env) => {
  const player = await authenticate(req, env);
  await enforceRateLimit(env.RL_WRITE, 'write', `player:${player.id}`);
  const sessionId = crypto.randomUUID();
  const seed = randomHex(16);
  await env.DB.prepare('INSERT INTO game_sessions (id, player_id, seed, created_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, player.id, seed, Date.now())
    .run();
  const res: StartGameResponse = { sessionId, seed };
  return json(res, { status: 201 });
});

interface SessionRow {
  id: string;
  player_id: string;
  seed: string;
  created_at: number;
  used_at: number | null;
}

route('POST', '/api/scores', async (req, env) => {
  const player = await authenticate(req, env);
  await enforceRateLimit(env.RL_WRITE, 'write', `player:${player.id}`);
  await enforceRateLimit(env.RL_WRITE, 'write', `ip:${clientIp(req)}`);

  const body = requireObject(await readJson(req, MAX_SCORE_BODY));
  const sessionId = requireUuid(body.sessionId, 'sessionId');
  const replay = requireObject(body.replay);
  const ticks = requireInt(replay.ticks, 'ticks', 1, MAX_GAME_TICKS);
  const inputs = replay.inputs;
  if (!Array.isArray(inputs) || inputs.length > MAX_REPLAY_INPUTS * 2) {
    throw new HttpError(400, 'invalid_replay', 'リプレイの形式が正しくありません');
  }

  const session = await env.DB.prepare('SELECT * FROM game_sessions WHERE id = ? AND player_id = ?')
    .bind(sessionId, player.id)
    .first<SessionRow>();
  if (!session) throw new HttpError(404, 'session_not_found', 'ゲームセッションが見つかりません');
  if (session.used_at !== null) throw new HttpError(409, 'session_used', 'このゲームのスコアは送信済みです');
  const now = Date.now();
  const elapsed = now - session.created_at;
  if (elapsed > SESSION_TTL_MS) throw new HttpError(410, 'session_expired', 'ゲームセッションの有効期限が切れています');

  // ゲーム内時間が実時間を超えていたら、加速ツールなどによる不正とみなす
  const gameMs = Math.round((ticks * 1000) / TICK_RATE);
  if (gameMs > elapsed + REALTIME_TOLERANCE_MS) {
    throw new HttpError(422, 'replay_too_fast', 'プレイ時間が実際の経過時間と一致しません');
  }

  // 検証の前にセッションを使用済みにする（同じセッションでの総当たりを防ぐ）
  const consumed = await env.DB.prepare('UPDATE game_sessions SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .bind(now, sessionId)
    .run();
  if (consumed.meta.changes !== 1) throw new HttpError(409, 'session_used', 'このゲームのスコアは送信済みです');

  const result = verifyReplay(session.seed, { inputs: inputs as number[], ticks }, {
    maxTicks: MAX_GAME_TICKS,
    maxInputs: MAX_REPLAY_INPUTS,
  });
  if (!result.ok) {
    throw new HttpError(422, 'replay_rejected', `リプレイを検証できませんでした（${result.error}）`);
  }
  const stats = result.stats;

  // クライアント申告値はログ用途のみ。記録にはサーバーの再計算結果だけを使う
  const claimed = body.claimed;
  if (claimed && typeof claimed === 'object' && (claimed as { score?: unknown }).score !== stats.score) {
    console.warn('score mismatch', { sessionId, claimed, verified: stats.score });
  }

  const gameId = crypto.randomUUID();
  const previous = await env.DB.prepare('SELECT score FROM player_best WHERE player_id = ?')
    .bind(player.id)
    .first<{ score: number }>();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO games (id, player_id, session_id, score, lines, level, pieces, ticks, duration_ms, played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(gameId, player.id, sessionId, stats.score, stats.lines, stats.level, stats.pieces, ticks, gameMs, now),
    env.DB.prepare('UPDATE players SET last_played_at = ? WHERE id = ?').bind(now, player.id),
    env.DB.prepare(
      `INSERT INTO player_best (player_id, game_id, score, lines, level, achieved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         game_id = excluded.game_id, score = excluded.score, lines = excluded.lines,
         level = excluded.level, achieved_at = excluded.achieved_at
       WHERE excluded.score > player_best.score`,
    ).bind(player.id, gameId, stats.score, stats.lines, stats.level, now),
  ]);

  const personalBest = !previous || stats.score > previous.score;
  const best = personalBest
    ? { score: stats.score, at: now }
    : await env.DB.prepare('SELECT score, achieved_at AS at FROM player_best WHERE player_id = ?')
        .bind(player.id)
        .first<{ score: number; at: number }>();

  const res: SubmitScoreResponse = {
    game: { id: gameId, score: stats.score, lines: stats.lines, level: stats.level, durationMs: gameMs, playedAt: now },
    personalBest,
    rank: await allTimeRank(env, best!.score, best!.at),
  };
  return json(res, { status: 201 });
});

// ---------------------------------------------------------------- 定期処理

/** 使われずに期限切れになったセッションを削除する */
export async function cleanupSessions(env: Env, now = Date.now()): Promise<number> {
  const res = await env.DB.prepare('DELETE FROM game_sessions WHERE used_at IS NULL AND created_at < ?')
    .bind(now - SESSION_TTL_MS - 60 * 60 * 1000)
    .run();
  return res.meta.changes ?? 0;
}
