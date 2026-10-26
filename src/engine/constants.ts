/**
 * ゲームエンジン定数。
 * エンジンはクライアント（ブラウザ）とサーバー（Workers）の両方で同じコードを実行し、
 * リプレイ検証で同一結果を得るため、浮動小数点を使わず整数演算のみで動作する。
 */

export const COLS = 10;
export const VISIBLE_ROWS = 20;
/** 画面外（上部）の非表示行。ブロックの出現位置として使う */
export const HIDDEN_ROWS = 2;
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

/** 1秒あたりのティック数（固定ステップ） */
export const TICK_RATE = 60;

/** 接地してから固定されるまでのティック数（0.5秒） */
export const LOCK_DELAY = 30;
/** 接地中の移動・回転による固定猶予リセットの上限回数 */
export const MAX_LOCK_RESETS = 15;
/** ライン消去アニメーションのティック数 */
export const CLEAR_DELAY = 20;
/** NEXT に表示する個数 */
export const NEXT_COUNT = 5;
/** 1ティックで受け付ける入力の最大数 */
export const MAX_ACTIONS_PER_TICK = 8;
/** 何ラインごとにレベルが上がるか */
export const LINES_PER_LEVEL = 10;

/** 重力の固定小数点スケール（1マス = 65536） */
export const G_UNIT = 65536;
/** 最大重力（20G：1ティックで20マス = 即着地） */
export const MAX_GRAVITY = 20 * G_UNIT;

/**
 * レベル別の重力（1ティックあたりの落下量 × 65536）。
 * ガイドラインの式 (0.8 - (L-1)*0.007)^(L-1) 秒/マス を事前計算して整数化したもの。
 * 実行時に Math.pow を使わないことで、ブラウザ間・サーバー間の差異を排除している。
 */
export const GRAVITY_TABLE: readonly number[] = [
  1092, 1377, 1768, 2311, 3075, 4169, 5759, 8107, 11634, 17026, 25416, 38709, 60169, 95483, 154742,
  256187, 433425, 749597, MAX_GRAVITY, MAX_GRAVITY,
];

export function gravityForLevel(level: number): number {
  const idx = Math.min(Math.max(level, 1), GRAVITY_TABLE.length) - 1;
  return Math.min(GRAVITY_TABLE[idx]!, MAX_GRAVITY);
}

/** 入力アクション。リプレイログにもこの数値で記録する */
export const Action = {
  Left: 0,
  Right: 1,
  RotateCW: 2,
  RotateCCW: 3,
  SoftDrop: 4,
  HardDrop: 5,
  Hold: 6,
} as const;
export type Action = (typeof Action)[keyof typeof Action];
export const ACTION_COUNT = 7;

export function isAction(n: unknown): n is Action {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < ACTION_COUNT;
}

/** ライン数ごとの基本点（× レベル） */
export const LINE_CLEAR_BASE = [0, 100, 300, 500, 800] as const;
export const COMBO_BASE = 50;
export const SOFT_DROP_POINTS = 1;
export const HARD_DROP_POINTS = 2;
