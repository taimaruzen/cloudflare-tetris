import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyReplay, type Replay } from '../src/engine';
import { playBot } from './helpers/bot';

const LIMITS = { maxTicks: 60 * 60 * 60 * 3, maxInputs: 300_000 };

describe('リプレイ検証（サーバー側の不正対策）', () => {
  const { replay, game } = playBot({ seed: 'replay-seed-1', thinkTicks: 3, mistakeRate: 0.08 });

  it('AI のプレイがゲームオーバーまで進み、得点が入っている', () => {
    assert.ok(game.over);
    assert.ok(game.score > 0);
    assert.ok(game.lines > 0, `lines=${game.lines}`);
  });

  it('正しいリプレイはクライアントと同じ結果を再現する', () => {
    const r = verifyReplay('replay-seed-1', replay, LIMITS);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.stats, game.stats);
  });

  it('別のシードでは同じ結果にならない', () => {
    const r = verifyReplay('another-seed', replay, LIMITS);
    assert.ok(!r.ok || r.stats.score !== game.score);
  });

  it('入力を改ざんすると結果が変わるか拒否される', () => {
    const tampered: Replay = { ...replay, inputs: replay.inputs.slice() };
    // 途中のハードドロップを左移動に書き換える
    const idx = tampered.inputs.findIndex((v, i) => i % 2 === 1 && v === 5 && i > 200);
    tampered.inputs[idx] = 0;
    const r = verifyReplay('replay-seed-1', tampered, LIMITS);
    assert.ok(!r.ok || r.stats.score !== game.score || r.stats.ticks !== game.ticks);
  });

  it('ゲームオーバーになっていないリプレイは拒否する', () => {
    const r = verifyReplay('replay-seed-1', { inputs: replay.inputs.slice(0, 40), ticks: 200 }, LIMITS);
    assert.equal(r.ok, false);
  });

  it('不正な形式（負の差分・未知のアクション・奇数長）は拒否する', () => {
    assert.equal(verifyReplay('s', { inputs: [-1, 0], ticks: 10 }, LIMITS).ok, false);
    assert.equal(verifyReplay('s', { inputs: [1, 99], ticks: 10 }, LIMITS).ok, false);
    assert.equal(verifyReplay('s', { inputs: [1], ticks: 10 }, LIMITS).ok, false);
    assert.equal(verifyReplay('s', { inputs: [1.5, 0], ticks: 10 }, LIMITS).ok, false);
    assert.equal(verifyReplay('s', { inputs: [20, 0], ticks: 10 }, LIMITS).ok, false);
  });

  it('1ティックに大量の入力を詰め込むと拒否する', () => {
    const inputs = [1, 0, ...Array.from({ length: 20 }, () => [0, 1]).flat()];
    assert.equal(verifyReplay('s', { inputs, ticks: 100000 }, LIMITS).ok, false);
  });

  it('上限を超えるティック数は拒否する', () => {
    assert.equal(verifyReplay('s', { inputs: [], ticks: LIMITS.maxTicks + 1 }, LIMITS).ok, false);
  });

  it('入力なし（放置）でもゲームオーバーまでのリプレイとして検証できる', () => {
    const idle = playBot({ seed: 'idle', thinkTicks: 1e9 });
    const r = verifyReplay('idle', idle.replay, LIMITS);
    assert.ok(r.ok);
    assert.equal(r.stats.score, 0);
  });
});

describe('高速スキップ（advanceIdle）の正しさ', () => {
  for (const [seed, think, mistake] of [
    ['eq-1', 0, 0.02],
    ['eq-2', 7, 0.1],
    ['eq-3', 25, 0.05],
    ['eq-4', 60, 0.3],
    ['eq-5', 2, 0.6],
  ] as const) {
    it(`1ティックずつ進めた結果と完全に一致する（${seed}）`, () => {
      const { replay, game } = playBot({ seed, thinkTicks: think, mistakeRate: mistake });
      const r = verifyReplay(seed, replay, LIMITS);
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(r.stats, game.stats);
    });
  }

  it('申告ティック数がずれていると拒否する', () => {
    const { replay } = playBot({ seed: 'eq-1', thinkTicks: 0, mistakeRate: 0.02 });
    assert.equal(verifyReplay('eq-1', { ...replay, ticks: replay.ticks + 1 }, LIMITS).ok, false);
    assert.equal(verifyReplay('eq-1', { ...replay, ticks: replay.ticks - 1 }, LIMITS).ok, false);
  });
});

describe('リプレイ検証の処理時間', () => {
  it('長時間のゲーム（約30分相当）でも短時間で検証できる', () => {
    const { replay, game } = playBot({ seed: 'long-game', thinkTicks: 40, mistakeRate: 0.01, maxTicks: 108_000 * 2 });
    const minutes = game.ticks / 60 / 60;
    const t0 = performance.now();
    const r = verifyReplay('long-game', replay, LIMITS);
    const ms = performance.now() - t0;
    console.log(`  ${minutes.toFixed(1)}分 / ${game.ticks}ティック / 入力${replay.inputs.length / 2}件 / ライン${game.lines} → 検証 ${ms.toFixed(1)}ms`);
    if (game.over) assert.ok(r.ok);
    assert.ok(ms < 2000);
  });
});
