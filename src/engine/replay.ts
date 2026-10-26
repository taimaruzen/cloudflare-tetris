import { MAX_ACTIONS_PER_TICK, type Action, isAction } from './constants';
import { Game, type GameStats } from './game';

/**
 * リプレイ形式。
 * inputs はフラットな数値配列 [Δtick, action, Δtick, action, ...]。
 * Δtick は「直前の入力からのティック差」（同一ティックの入力は 0）。
 * 入力は「その番号のティックの step() に渡される」。最初の step は tick 1。
 */
export interface Replay {
  inputs: number[];
  /** ゲームオーバーになったティック番号 */
  ticks: number;
}

export class ReplayRecorder {
  private readonly inputs: number[] = [];
  private lastTick = 0;

  record(tick: number, action: Action): void {
    this.inputs.push(tick - this.lastTick, action);
    this.lastTick = tick;
  }

  finish(ticks: number): Replay {
    return { inputs: [...this.inputs], ticks };
  }

  get size(): number {
    return this.inputs.length / 2;
  }
}

export interface ReplayLimits {
  maxTicks: number;
  maxInputs: number;
}

export type VerifyResult =
  | { ok: true; stats: GameStats }
  | { ok: false; error: string };

/**
 * サーバー側でリプレイを最初から再生し、スコアを再計算する。
 * クライアントが申告したスコアは信用せず、この結果のみを記録に使う。
 */
export function verifyReplay(seed: string, replay: Replay, limits: ReplayLimits): VerifyResult {
  const { inputs, ticks } = replay;
  if (!Array.isArray(inputs) || inputs.length % 2 !== 0) return { ok: false, error: 'malformed_inputs' };
  if (inputs.length / 2 > limits.maxInputs) return { ok: false, error: 'too_many_inputs' };
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > limits.maxTicks) return { ok: false, error: 'invalid_ticks' };

  // 入力列を検証しつつ絶対ティックへ変換
  const absTicks = new Int32Array(inputs.length / 2);
  const actions = new Uint8Array(inputs.length / 2);
  let t = 0;
  let sameTickCount = 0;
  for (let i = 0; i < inputs.length; i += 2) {
    const dt = inputs[i];
    const a = inputs[i + 1];
    if (!Number.isInteger(dt) || (dt as number) < 0) return { ok: false, error: 'invalid_delta' };
    if (!isAction(a)) return { ok: false, error: 'invalid_action' };
    if (i === 0 && dt === 0) return { ok: false, error: 'invalid_delta' };
    sameTickCount = dt === 0 ? sameTickCount + 1 : 1;
    if (sameTickCount > MAX_ACTIONS_PER_TICK) return { ok: false, error: 'too_many_actions_per_tick' };
    t += dt as number;
    if (t > ticks) return { ok: false, error: 'input_after_end' };
    absTicks[i / 2] = t;
    actions[i / 2] = a;
  }

  const game = new Game(seed);
  game.recordEvents = false;
  const buf: Action[] = [];
  let idx = 0;
  while (idx < absTicks.length) {
    const tick = absTicks[idx]!;
    // 入力のあるティックの直前まで一気に進める
    game.advanceIdle(tick - 1 - game.ticks);
    if (game.over) return { ok: false, error: 'input_after_game_over' };
    buf.length = 0;
    while (idx < absTicks.length && absTicks[idx] === tick) {
      buf.push(actions[idx]! as Action);
      idx++;
    }
    game.step(buf);
  }
  if (game.over && game.ticks < ticks) return { ok: false, error: 'tick_mismatch' };
  game.advanceIdle(ticks - game.ticks);
  if (!game.over) return { ok: false, error: 'game_not_over' };
  if (game.ticks !== ticks) return { ok: false, error: 'tick_mismatch' };
  return { ok: true, stats: game.stats };
}

