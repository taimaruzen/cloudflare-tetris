import {
  Action,
  CLEAR_DELAY,
  COLS,
  COMBO_BASE,
  G_UNIT,
  HARD_DROP_POINTS,
  HIDDEN_ROWS,
  LINES_PER_LEVEL,
  LINE_CLEAR_BASE,
  LOCK_DELAY,
  MAX_ACTIONS_PER_TICK,
  MAX_LOCK_RESETS,
  NEXT_COUNT,
  ROWS,
  SOFT_DROP_POINTS,
  gravityForLevel,
} from './constants';
import { SHAPES, SPAWN_X, getKicks, type PieceType, type Rotation } from './pieces';
import { Rng, SevenBag, hashSeed } from './rng';

const NO_ACTIONS: readonly Action[] = [];

export interface ActivePiece {
  type: PieceType;
  rot: Rotation;
  x: number;
  y: number;
}

export type GameEvent =
  | { kind: 'lock'; type: PieceType }
  | { kind: 'hardDrop'; distance: number }
  | { kind: 'clear'; rows: number[]; lines: number; points: number; b2b: boolean; combo: number }
  | { kind: 'levelUp'; level: number }
  | { kind: 'hold' }
  | { kind: 'gameOver'; reason: 'blockOut' | 'lockOut' };

export interface GameStats {
  score: number;
  lines: number;
  level: number;
  ticks: number;
  pieces: number;
}

/**
 * 決定的な落ち物パズルエンジン。
 * 1回の step() が 1ティック（1/60秒）。同じシードと同じ入力列からは必ず同じ結果になる。
 */
export class Game {
  /** board[y * COLS + x]。0 = 空、1〜7 = ブロック種別 */
  readonly board = new Uint8Array(COLS * ROWS);
  active: ActivePiece | null = null;
  hold: PieceType | null = null;
  holdUsed = false;
  readonly queue: PieceType[] = [];

  score = 0;
  lines = 0;
  level = 1;
  ticks = 0;
  pieces = 0;
  combo = -1;
  backToBack = false;
  over = false;
  overReason: 'blockOut' | 'lockOut' | null = null;

  /** 消去アニメーション中の行と残りティック */
  clearing: { rows: number[]; timer: number } | null = null;

  private gravityAcc = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private lowestY = 0;
  private readonly bag: SevenBag;

  /** 直近の step() で発生したイベント（UI のエフェクト用）。step() ごとに中身を入れ替える */
  readonly events: GameEvent[] = [];
  /** false にするとイベントを記録しない（サーバー検証時の高速化） */
  recordEvents = true;

  constructor(seed: string, readonly startLevel = 1) {
    this.level = startLevel;
    this.bag = new SevenBag(new Rng(hashSeed(seed)));
    this.fillQueue();
    this.spawn(this.queue.shift()!);
  }

  get stats(): GameStats {
    return { score: this.score, lines: this.lines, level: this.level, ticks: this.ticks, pieces: this.pieces };
  }

  get next(): PieceType[] {
    return this.queue.slice(0, NEXT_COUNT);
  }

  cell(x: number, y: number): number {
    return this.board[y * COLS + x]!;
  }

  /** 1ティック進める。actions はこのティックに入力されたアクション列 */
  step(actions: readonly Action[] = NO_ACTIONS): void {
    if (this.events.length) this.events.length = 0;
    if (this.over) return;
    this.ticks++;

    if (this.clearing) {
      this.clearing.timer--;
      if (this.clearing.timer <= 0) {
        this.collapseRows(this.clearing.rows);
        this.clearing = null;
        this.spawn(this.takeNext());
      }
      return;
    }

    const n = Math.min(actions.length, MAX_ACTIONS_PER_TICK);
    for (let i = 0; i < n; i++) {
      if (!this.active || this.over) break;
      this.apply(actions[i]!);
    }
    if (!this.active || this.over) return;

    this.applyGravity();
    if (!this.active) return;

    if (this.isGrounded()) {
      this.lockTimer++;
      if (this.lockTimer >= LOCK_DELAY || this.lockResets >= MAX_LOCK_RESETS) {
        this.lockPiece();
      }
    } else {
      this.lockTimer = 0;
    }
  }

  /**
   * 入力のないティックを n 回分進める（step() を n 回呼ぶのと同じ結果）。
   * 何も起きないティック（重力の蓄積・固定待ち・消去待ち）をまとめて処理するので、
   * サーバー側のリプレイ検証が CPU 時間の上限内に収まる。
   */
  advanceIdle(n: number): void {
    while (n > 0 && !this.over) {
      let skip = 0;
      if (this.clearing) {
        skip = this.clearing.timer - 1;
        if (skip > 0) {
          skip = Math.min(skip, n);
          this.clearing.timer -= skip;
        }
      } else if (this.active) {
        if (this.isGrounded()) {
          if (this.lockResets < MAX_LOCK_RESETS) {
            skip = Math.min(LOCK_DELAY - this.lockTimer - 1, n);
            if (skip > 0) {
              this.lockTimer += skip;
              this.gravityAcc = 0;
            }
          }
        } else {
          // 着地するティックの直前まで、複数段の落下をまとめて計算する
          const p = this.active;
          const g = gravityForLevel(this.level);
          const distance = this.ghostY() - p.y;
          const landTick = Math.ceil((distance * G_UNIT - this.gravityAcc) / g);
          skip = Math.min(landTick - 1, n);
          if (skip > 0) {
            const total = this.gravityAcc + skip * g;
            const drops = Math.floor(total / G_UNIT);
            this.gravityAcc = total - drops * G_UNIT;
            p.y += drops;
            if (p.y > this.lowestY) {
              this.lowestY = p.y;
              this.lockResets = 0;
            }
            this.lockTimer = 0;
          }
        }
      }
      if (skip > 0) {
        this.ticks += skip;
        n -= skip;
        if (this.events.length) this.events.length = 0;
        continue;
      }
      this.step();
      n--;
    }
  }

  private apply(action: Action): void {
    switch (action) {
      case Action.Left:
        this.tryMove(-1, 0, true);
        break;
      case Action.Right:
        this.tryMove(1, 0, true);
        break;
      case Action.RotateCW:
        this.tryRotate(1);
        break;
      case Action.RotateCCW:
        this.tryRotate(-1);
        break;
      case Action.SoftDrop:
        if (this.tryMove(0, 1, false)) {
          this.score += SOFT_DROP_POINTS;
          this.gravityAcc = 0;
        }
        break;
      case Action.HardDrop:
        this.hardDrop();
        break;
      case Action.Hold:
        this.doHold();
        break;
    }
  }

  // ---------- 衝突判定と移動 ----------

  collides(type: PieceType, rot: Rotation, x: number, y: number): boolean {
    for (const [cx, cy] of SHAPES[type][rot]!) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && this.board[by * COLS + bx] !== 0) return true;
    }
    return false;
  }

  isGrounded(): boolean {
    const p = this.active;
    return !!p && this.collides(p.type, p.rot, p.x, p.y + 1);
  }

  private tryMove(dx: number, dy: number, resetsLock: boolean): boolean {
    const p = this.active;
    if (!p || this.collides(p.type, p.rot, p.x + dx, p.y + dy)) return false;
    p.x += dx;
    p.y += dy;
    this.afterMove(resetsLock);
    return true;
  }

  private tryRotate(dir: 1 | -1): boolean {
    const p = this.active;
    if (!p) return false;
    const to = ((p.rot + dir + 4) % 4) as Rotation;
    for (const [kx, ky] of getKicks(p.type, p.rot, to)) {
      if (!this.collides(p.type, to, p.x + kx, p.y + ky)) {
        p.rot = to;
        p.x += kx;
        p.y += ky;
        this.afterMove(true);
        return true;
      }
    }
    return false;
  }

  /** 接地中の操作で固定猶予をリセット（上限あり）。より低い段に到達したらリセット回数も戻す */
  private afterMove(resetsLock: boolean): void {
    const p = this.active!;
    if (p.y > this.lowestY) {
      this.lowestY = p.y;
      this.lockResets = 0;
      this.lockTimer = 0;
      return;
    }
    if (resetsLock && this.lockTimer > 0 && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  private applyGravity(): void {
    const p = this.active!;
    if (this.isGrounded()) {
      this.gravityAcc = 0;
      return;
    }
    this.gravityAcc += gravityForLevel(this.level);
    while (this.gravityAcc >= G_UNIT) {
      this.gravityAcc -= G_UNIT;
      if (this.collides(p.type, p.rot, p.x, p.y + 1)) {
        this.gravityAcc = 0;
        break;
      }
      p.y++;
      this.afterMove(false);
    }
  }

  ghostY(): number {
    const p = this.active;
    if (!p) return 0;
    let y = p.y;
    while (!this.collides(p.type, p.rot, p.x, y + 1)) y++;
    return y;
  }

  private hardDrop(): void {
    const p = this.active!;
    const target = this.ghostY();
    const distance = target - p.y;
    p.y = target;
    this.score += distance * HARD_DROP_POINTS;
    this.emit({ kind: 'hardDrop', distance });
    this.lockPiece();
  }

  private doHold(): void {
    if (this.holdUsed || !this.active) return;
    const current = this.active.type;
    const next = this.hold ?? this.takeNext();
    this.hold = current;
    this.holdUsed = true;
    this.emit({ kind: 'hold' });
    this.spawn(next);
  }

  // ---------- 出現・固定・消去 ----------

  private fillQueue(): void {
    while (this.queue.length < NEXT_COUNT + 1) this.queue.push(this.bag.next());
  }

  private takeNext(): PieceType {
    const t = this.queue.shift()!;
    this.fillQueue();
    return t;
  }

  private spawn(type: PieceType): void {
    // 3x3 は非表示2行の直下（最上段が見える位置）に出す
    const y = HIDDEN_ROWS - 1;
    this.active = { type, rot: 0, x: SPAWN_X, y };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = y;
    if (this.collides(type, 0, SPAWN_X, y)) {
      // 1段上にずらせるなら許容（ガイドライン準拠）
      if (!this.collides(type, 0, SPAWN_X, y - 1)) {
        this.active.y = y - 1;
        this.lowestY = y - 1;
      } else {
        this.endGame('blockOut');
      }
    }
  }

  private lockPiece(): void {
    const p = this.active!;
    let allHidden = true;
    for (const [cx, cy] of SHAPES[p.type][p.rot]!) {
      const bx = p.x + cx;
      const by = p.y + cy;
      if (by >= 0) this.board[by * COLS + bx] = p.type;
      if (by >= HIDDEN_ROWS) allHidden = false;
    }
    this.active = null;
    this.holdUsed = false;
    this.pieces++;
    this.emit({ kind: 'lock', type: p.type });

    if (allHidden) {
      this.endGame('lockOut');
      return;
    }

    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) {
      let filled = true;
      for (let x = 0; x < COLS; x++) {
        if (this.board[y * COLS + x] === 0) {
          filled = false;
          break;
        }
      }
      if (filled) full.push(y);
    }

    this.scoreLines(full);
    if (full.length > 0) {
      this.clearing = { rows: full, timer: CLEAR_DELAY };
    } else {
      this.spawn(this.takeNext());
    }
  }

  private scoreLines(rows: number[]): void {
    const n = rows.length;
    if (n === 0) {
      this.combo = -1;
      return;
    }
    const level = this.level;
    let points = LINE_CLEAR_BASE[n as 1 | 2 | 3 | 4] * level;
    const difficult = n === 4;
    const b2b = difficult && this.backToBack;
    if (b2b) points = (points * 3) / 2;
    this.backToBack = difficult;
    this.combo++;
    if (this.combo > 0) points += COMBO_BASE * this.combo * level;

    this.score += points;
    this.lines += n;
    this.emit({ kind: 'clear', rows, lines: n, points, b2b, combo: this.combo });

    const newLevel = this.startLevel + Math.floor(this.lines / LINES_PER_LEVEL);
    if (newLevel > this.level) {
      this.level = newLevel;
      this.emit({ kind: 'levelUp', level: newLevel });
    }
  }

  /** 消えた行を取り除き、上の行を下に詰める（rows は昇順） */
  private collapseRows(rows: number[]): void {
    const b = this.board;
    let write = ROWS - 1;
    let r = rows.length - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (r >= 0 && rows[r] === y) {
        r--;
        continue;
      }
      if (write !== y) b.copyWithin(write * COLS, y * COLS, (y + 1) * COLS);
      write--;
    }
    b.fill(0, 0, (write + 1) * COLS);
  }

  private emit(e: GameEvent): void {
    if (this.recordEvents) this.events.push(e);
  }

  private endGame(reason: 'blockOut' | 'lockOut'): void {
    this.over = true;
    this.overReason = reason;
    this.active = null;
    this.emit({ kind: 'gameOver', reason });
  }

  // ---------- テスト用 ----------

  /** テスト用：盤面を文字列から設定する（下詰め、'#' または種別文字で埋まり） */
  loadBoard(rows: string[]): void {
    this.board.fill(0);
    const start = ROWS - rows.length;
    rows.forEach((line, i) => {
      for (let x = 0; x < COLS; x++) {
        const ch = line[x] ?? '.';
        if (ch !== '.' && ch !== ' ') this.board[(start + i) * COLS + x] = 1 + (ch.charCodeAt(0) % 7);
      }
    });
  }

  /** テスト用：操作中のブロックを差し替える */
  setActive(type: PieceType, x = SPAWN_X, y = HIDDEN_ROWS - 1, rot: Rotation = 0): void {
    this.active = { type, rot, x, y };
    this.lowestY = y;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.gravityAcc = 0;
  }
}
