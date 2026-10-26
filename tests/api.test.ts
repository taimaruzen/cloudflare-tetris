import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import worker from '../src/worker/index';
import { cleanupSessions, periodStart } from '../src/worker/api';
import type { Env } from '../src/worker/env';
import type {
  CreatePlayerResponse,
  HealthResponse,
  PlayerProfileResponse,
  RankingResponse,
  StartGameResponse,
  SubmitScoreResponse,
} from '../src/shared/api-types';
import { D1Shim } from './helpers/d1-shim';
import { playBot } from './helpers/bot';

const ORIGIN = 'https://tetris.example.workers.dev';
const db = new D1Shim(join(import.meta.dirname, '..', 'migrations'));
const env = {
  DB: db,
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) },
} as unknown as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

let ipCounter = 0;
/** テストごとに別の IP にしてレート制限の影響を分離する */
function freshIp() {
  return `203.0.113.${++ipCounter}`;
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string; ip?: string; origin?: string | null; contentType?: string } = {},
) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': init.ip ?? '198.51.100.1' };
  if (init.body !== undefined) headers['Content-Type'] = init.contentType ?? 'application/json';
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`;
  if (init.origin !== null) headers['Origin'] = init.origin ?? ORIGIN;
  const req = new Request(ORIGIN + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
  const res = await worker.fetch!(req as never, env, ctx);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function createPlayer(nickname: string) {
  const r = await call('/api/players', { method: 'POST', body: { nickname }, ip: freshIp() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as CreatePlayerResponse;
}

async function startSession(token: string) {
  const r = await call('/api/games', { method: 'POST', body: {}, token });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as StartGameResponse;
}

/** セッションの開始時刻を過去にずらす（実時間チェックを通すため） */
function backdate(sessionId: string, ms: number) {
  db.raw.prepare('UPDATE game_sessions SET created_at = created_at - ? WHERE id = ?').run(ms, sessionId);
}

async function playAndSubmit(token: string, opts: { think?: number; mistake?: number; claimedScore?: number } = {}) {
  const s = await startSession(token);
  const { replay, game } = playBot({ seed: s.seed, thinkTicks: opts.think ?? 3, mistakeRate: opts.mistake ?? 0.05 });
  backdate(s.sessionId, (replay.ticks * 1000) / 60 + 1000);
  const r = await call('/api/scores', {
    method: 'POST',
    token,
    body: {
      sessionId: s.sessionId,
      replay,
      claimed: { score: opts.claimedScore ?? game.score, lines: game.lines, level: game.level },
    },
  });
  return { r, game, session: s, replay };
}

describe('API: 基本', () => {
  it('GET /api/health はデータベースの状態を返す', async () => {
    const r = await call('/api/health');
    assert.equal(r.status, 200);
    const b = r.body as HealthResponse;
    assert.equal(b.ok, true);
    assert.equal(b.database, 'ok');
    assert.equal(b.turnstileSiteKey, null);
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  it('存在しない API は 404、メソッド違いは 405', async () => {
    assert.equal((await call('/api/unknown')).status, 404);
    assert.equal((await call('/api/health', { method: 'POST', body: {} })).status, 405);
  });

  it('API 以外のパスは静的アセットに渡す', async () => {
    const res = await worker.fetch!(new Request(ORIGIN + '/') as never, env, ctx);
    assert.match(await res.text(), /doctype/);
  });
});

describe('API: プレイヤー登録', () => {
  it('ニックネームを正規化して登録し、トークンを返す', async () => {
    const r = await call('/api/players', { method: 'POST', body: { nickname: '  ＮＥＯＮ　ACE ' }, ip: freshIp() });
    assert.equal(r.status, 201);
    const b = r.body as CreatePlayerResponse;
    assert.equal(b.player.nickname, 'NEON ACE');
    assert.match(b.token, /^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    // トークンの平文は保存しない
    const row = db.raw.prepare('SELECT token_hash FROM players WHERE id = ?').get(b.player.id) as { token_hash: string };
    assert.notEqual(row.token_hash, b.token.split('.')[1]);
  });

  it('不正なニックネームは 400', async () => {
    for (const nickname of ['', '   ', 'a'.repeat(17), 'bad\u0000name', '<script>', 'x‮y', 123, null]) {
      const r = await call('/api/players', { method: 'POST', body: { nickname }, ip: freshIp() });
      assert.equal(r.status, 400, `nickname=${JSON.stringify(nickname)}`);
      assert.equal(r.body.error.code, 'invalid_nickname');
    }
  });

  it('JSON 以外・壊れた JSON・巨大な本文は拒否する', async () => {
    assert.equal((await call('/api/players', { method: 'POST', body: 'x', contentType: 'text/plain', ip: freshIp() })).status, 415);
    assert.equal((await call('/api/players', { method: 'POST', body: '{bad', ip: freshIp() })).status, 400);
    const big = { nickname: 'a', pad: 'x'.repeat(10_000) };
    assert.equal((await call('/api/players', { method: 'POST', body: big, ip: freshIp() })).status, 413);
  });

  it('別オリジンからの書き込みは 403', async () => {
    const r = await call('/api/players', { method: 'POST', body: { nickname: 'evil' }, origin: 'https://evil.example', ip: freshIp() });
    assert.equal(r.status, 403);
  });

  it('同じ IP から短時間に大量登録すると 429', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call('/api/players', { method: 'POST', body: { nickname: `bot${i}` }, ip })).status);
    assert.deepEqual(statuses.slice(0, 5), [201, 201, 201, 201, 201]);
    assert.equal(statuses[6], 429);
  });

  it('GET /api/players/:id で公開情報を返す（トークンは含まない）', async () => {
    const p = await createPlayer('profile');
    const r = await call(`/api/players/${p.player.id}`);
    assert.equal(r.status, 200);
    const b = r.body as PlayerProfileResponse;
    assert.equal(b.player.nickname, 'profile');
    assert.equal(b.best, null);
    assert.equal(b.totalGames, 0);
    assert.ok(!JSON.stringify(b).includes('token'));
    assert.equal((await call('/api/players/not-a-uuid')).status, 400);
    assert.equal((await call('/api/players/00000000-0000-4000-8000-000000000000')).status, 404);
  });
});

describe('API: ゲーム開始とスコア送信（サーバー側検証）', () => {
  let alice: CreatePlayerResponse;
  let bob: CreatePlayerResponse;
  before(async () => {
    alice = await createPlayer('alice');
    bob = await createPlayer('bob');
  });

  it('認証なし・不正なトークンではゲームを開始できない', async () => {
    assert.equal((await call('/api/games', { method: 'POST', body: {} })).status, 401);
    const forged = `${alice.player.id}.${'0'.repeat(64)}`;
    assert.equal((await call('/api/games', { method: 'POST', body: {}, token: forged })).status, 401);
  });

  it('正しいリプレイはサーバーで再計算され、D1 に保存される', async () => {
    const { r, game } = await playAndSubmit(alice.token);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const b = r.body as SubmitScoreResponse;
    assert.equal(b.game.score, game.score);
    assert.equal(b.game.lines, game.lines);
    assert.equal(b.personalBest, true);
    assert.equal(b.rank >= 1, true);
    const row = db.raw.prepare('SELECT * FROM games WHERE id = ?').get(b.game.id) as Record<string, number>;
    assert.equal(row.score, game.score);
    assert.equal(row.level, game.level);
    assert.ok((row.duration_ms ?? 0) > 0);
  });

  it('クライアントが申告したスコアは信用せず、再計算した値を保存する', async () => {
    const { r, game } = await playAndSubmit(alice.token, { claimedScore: 99_999_999 });
    assert.equal(r.status, 201);
    assert.equal((r.body as SubmitScoreResponse).game.score, game.score);
  });

  it('同じセッションで2回送信すると 409', async () => {
    const { r, session, replay } = await playAndSubmit(bob.token);
    assert.equal(r.status, 201);
    const again = await call('/api/scores', {
      method: 'POST',
      token: bob.token,
      body: { sessionId: session.sessionId, replay, claimed: { score: 0, lines: 0, level: 1 } },
    });
    assert.equal(again.status, 409);
  });

  it('実時間より速く進んだゲーム（加速ツール）は拒否する', async () => {
    const s = await startSession(bob.token);
    const { replay } = playBot({ seed: s.seed, thinkTicks: 3 });
    const r = await call('/api/scores', { method: 'POST', token: bob.token, body: { sessionId: s.sessionId, replay, claimed: {} } });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'replay_too_fast');
  });

  it('別のシードで作ったリプレイ（シードの差し替え）は拒否または低い値になる', async () => {
    const s = await startSession(bob.token);
    const { replay, game } = playBot({ seed: 'attacker-chosen-seed', thinkTicks: 3 });
    backdate(s.sessionId, 60 * 60 * 1000);
    const r = await call('/api/scores', { method: 'POST', token: bob.token, body: { sessionId: s.sessionId, replay, claimed: {} } });
    assert.ok(r.status === 422 || (r.body as SubmitScoreResponse).game.score !== game.score, `status=${r.status}`);
  });

  it('改ざんされたリプレイは 422、そのセッションは使用済みになる', async () => {
    const s = await startSession(bob.token);
    backdate(s.sessionId, 60 * 60 * 1000);
    const bad = await call('/api/scores', {
      method: 'POST',
      token: bob.token,
      body: { sessionId: s.sessionId, replay: { inputs: [1, 99], ticks: 100 }, claimed: {} },
    });
    assert.equal(bad.status, 422);
    const { replay } = playBot({ seed: s.seed, thinkTicks: 3 });
    const retry = await call('/api/scores', { method: 'POST', token: bob.token, body: { sessionId: s.sessionId, replay, claimed: {} } });
    assert.equal(retry.status, 409);
  });

  it('他人のセッションには送信できない', async () => {
    const s = await startSession(alice.token);
    backdate(s.sessionId, 60 * 60 * 1000);
    const { replay } = playBot({ seed: s.seed, thinkTicks: 3 });
    const r = await call('/api/scores', { method: 'POST', token: bob.token, body: { sessionId: s.sessionId, replay, claimed: {} } });
    assert.equal(r.status, 404);
  });

  it('期限切れのセッションは 410', async () => {
    const s = await startSession(alice.token);
    backdate(s.sessionId, 7 * 60 * 60 * 1000);
    const { replay } = playBot({ seed: s.seed, thinkTicks: 3 });
    const r = await call('/api/scores', { method: 'POST', token: alice.token, body: { sessionId: s.sessionId, replay, claimed: {} } });
    assert.equal(r.status, 410);
  });

  it('形式が不正な送信は 400', async () => {
    const s = await startSession(alice.token);
    const cases = [
      { sessionId: 'nope', replay: { inputs: [], ticks: 10 } },
      { sessionId: s.sessionId, replay: { inputs: 'x', ticks: 10 } },
      { sessionId: s.sessionId, replay: { inputs: [], ticks: -1 } },
      { sessionId: s.sessionId, replay: { inputs: [], ticks: 1e12 } },
      { sessionId: s.sessionId },
    ];
    for (const body of cases) {
      const r = await call('/api/scores', { method: 'POST', token: alice.token, body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });
});

describe('API: ランキング', () => {
  it('全期間・週間・日間ランキングはプレイヤーごとの最高記録を高い順に返す', async () => {
    const carol = await createPlayer('carol');
    const dave = await createPlayer('dave');
    const c1 = await playAndSubmit(carol.token, { think: 3, mistake: 0.02 });
    const c2 = await playAndSubmit(carol.token, { think: 1, mistake: 0.4 });
    const d1 = await playAndSubmit(dave.token, { think: 2, mistake: 0.1 });
    for (const x of [c1, c2, d1]) assert.equal(x.r.status, 201);
    const carolBest = Math.max(c1.game.score, c2.game.score);

    for (const path of ['/api/rankings', '/api/rankings/weekly', '/api/rankings/daily']) {
      const r = await call(path + '?limit=100');
      assert.equal(r.status, 200);
      const b = r.body as RankingResponse;
      const ids = b.entries.map((e) => e.playerId);
      assert.equal(new Set(ids).size, ids.length, '1人1行');
      const carolEntry = b.entries.find((e) => e.playerId === carol.player.id)!;
      assert.equal(carolEntry.score, carolBest);
      assert.equal(carolEntry.nickname, 'carol');
      for (let i = 1; i < b.entries.length; i++) assert.ok(b.entries[i - 1]!.score >= b.entries[i]!.score);
      b.entries.forEach((e, i) => assert.equal(e.rank, i + 1));
    }

    const profile = (await call(`/api/players/${carol.player.id}`)).body as PlayerProfileResponse;
    assert.equal(profile.best!.score, carolBest);
    assert.equal(profile.totalGames, 2);
    assert.equal(profile.recent.length, 2);
    const all = (await call('/api/rankings?limit=100')).body as RankingResponse;
    assert.equal(profile.best!.rank, all.entries.find((e) => e.playerId === carol.player.id)!.rank);
  });

  it('limit の検証', async () => {
    assert.equal((await call('/api/rankings?limit=0')).status, 400);
    assert.equal((await call('/api/rankings?limit=abc')).status, 400);
    assert.equal((await call('/api/rankings?limit=101')).status, 400);
    assert.equal((await call('/api/rankings?limit=3')).body.entries.length <= 3, true);
  });

  it('集計期間は UTC の今日0時・今週月曜0時', () => {
    const wed = Date.UTC(2026, 9, 28, 15, 30); // 2026-10-28 (水)
    assert.equal(periodStart('daily', wed), Date.UTC(2026, 9, 28));
    assert.equal(periodStart('weekly', wed), Date.UTC(2026, 9, 26));
    const sun = Date.UTC(2026, 10, 1, 23, 59);
    assert.equal(periodStart('weekly', sun), Date.UTC(2026, 9, 26));
    assert.equal(periodStart('all', wed), null);
  });
});

describe('定期処理', () => {
  it('期限切れの未使用セッションだけを削除する', async () => {
    const p = await createPlayer('cleanup');
    const old = await startSession(p.token);
    const fresh = await startSession(p.token);
    backdate(old.sessionId, 24 * 60 * 60 * 1000);
    await cleanupSessions(env);
    const ids = (db.raw.prepare('SELECT id FROM game_sessions WHERE player_id = ?').all(p.player.id) as { id: string }[]).map((r) => r.id);
    assert.ok(!ids.includes(old.sessionId));
    assert.ok(ids.includes(fresh.sessionId));
  });
});
