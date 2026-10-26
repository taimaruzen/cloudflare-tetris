import { Action, COLS, Game, ROWS, ReplayRecorder, SHAPES, type Replay, type Rotation } from '../../src/engine';

/** 盤面を評価する簡易 AI（テストで長いゲームを作るため） */
function evaluate(board: Uint8Array): number {
  let agg = 0;
  let holes = 0;
  let bump = 0;
  let prev = -1;
  let complete = 0;
  for (let y = 0; y < ROWS; y++) {
    let full = true;
    for (let x = 0; x < COLS; x++) if (!board[y * COLS + x]) full = false;
    if (full) complete++;
  }
  for (let x = 0; x < COLS; x++) {
    let h = 0;
    for (let y = 0; y < ROWS; y++) {
      if (board[y * COLS + x]) {
        if (!h) h = ROWS - y;
      } else if (h) holes++;
    }
    agg += h;
    if (prev >= 0) bump += Math.abs(h - prev);
    prev = h;
  }
  return -0.51 * agg + 0.76 * complete - 0.36 * holes - 0.18 * bump;
}

function bestPlacement(game: Game): { rot: Rotation; x: number } {
  const p = game.active!;
  let best = { rot: 0 as Rotation, x: p.x, score: -Infinity };
  for (let rot = 0 as Rotation; rot < 4; rot = (rot + 1) as Rotation) {
    for (let x = -2; x < COLS; x++) {
      if (game.collides(p.type, rot, x, p.y)) continue;
      let y = p.y;
      while (!game.collides(p.type, rot, x, y + 1)) y++;
      const b = game.board.slice();
      for (const [cx, cy] of SHAPES[p.type][rot]!) if (y + cy >= 0) b[(y + cy) * COLS + x + cx] = p.type;
      const s = evaluate(b);
      if (s > best.score) best = { rot, x, score: s };
    }
  }
  return best;
}

export interface BotOptions {
  seed: string;
  /** 1手ごとに待つティック数（長いゲームを作る） */
  thinkTicks?: number;
  /** ランダムに手を崩す確率（ゲームを終わらせるため） */
  mistakeRate?: number;
  maxTicks?: number;
}

/** AI にプレイさせ、ゲームオーバーまでのリプレイと最終結果を返す */
export function playBot(opts: BotOptions): { replay: Replay; game: Game } {
  const game = new Game(opts.seed);
  const rec = new ReplayRecorder();
  const think = opts.thinkTicks ?? 5;
  const mistake = opts.mistakeRate ?? 0.05;
  const maxTicks = opts.maxTicks ?? 2_000_000;
  let rand = 12345;
  const rnd = () => ((rand = (Math.imul(rand, 1103515245) + 12345) >>> 0) / 0x100000000);

  let plan: Action[] = [];
  let wait = think;
  while (!game.over && game.ticks < maxTicks) {
    const tick = game.ticks + 1;
    const actions: Action[] = [];
    if (game.active && !game.clearing) {
      if (plan.length === 0 && wait-- <= 0) {
        wait = think;
        const t = bestPlacement(game);
        const target = rnd() < mistake ? { rot: (Math.floor(rnd() * 4) as Rotation), x: Math.floor(rnd() * 8) } : t;
        const p = game.active;
        const rots = (target.rot - p.rot + 4) % 4;
        if (rots === 3) plan.push(Action.RotateCCW);
        else for (let i = 0; i < rots; i++) plan.push(Action.RotateCW);
        // 回転後の位置ずれは移動前に再計算できないため多めに入力し、壁で止まるのに任せない
        const dx = target.x - p.x;
        for (let i = 0; i < Math.abs(dx); i++) plan.push(dx < 0 ? Action.Left : Action.Right);
        if (rnd() < 0.3) plan.push(Action.SoftDrop, Action.SoftDrop);
        if (rnd() < 0.05) plan.unshift(Action.Hold);
        plan.push(Action.HardDrop);
      }
      // 1ティックに1〜2アクション
      const n = Math.min(plan.length, 1 + Math.floor(rnd() * 2));
      for (let i = 0; i < n; i++) actions.push(plan.shift()!);
    } else {
      plan = [];
    }
    for (const a of actions) rec.record(tick, a);
    game.step(actions);
  }
  return { replay: rec.finish(game.ticks), game };
}
