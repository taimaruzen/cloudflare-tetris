/**
 * 7種類のブロック定義と SRS（Super Rotation System）の壁蹴りテーブル。
 * 座標は x が右方向、y が下方向。
 */

export const PieceType = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 } as const;
export type PieceType = (typeof PieceType)[keyof typeof PieceType];
export const PIECE_TYPES: readonly PieceType[] = [1, 2, 3, 4, 5, 6, 7];
export const PIECE_NAMES: Record<PieceType, string> = { 1: 'I', 2: 'O', 3: 'T', 4: 'S', 5: 'Z', 6: 'J', 7: 'L' };

/** 回転状態: 0=出現, 1=右(R), 2=180°, 3=左(L) */
export type Rotation = 0 | 1 | 2 | 3;
export type Cell = readonly [number, number];

interface ShapeDef {
  size: number;
  cells: Cell[];
}

/** 出現時（状態0）の形。size はバウンディングボックスの一辺 */
const SPAWN_SHAPES: Record<PieceType, ShapeDef> = {
  1: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  2: { size: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  3: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  4: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  5: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  6: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  7: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

function rotateCW(cells: Cell[], size: number): Cell[] {
  return cells.map(([x, y]) => [size - 1 - y, x] as const);
}

/** SHAPES[type][rotation] = セル一覧 */
export const SHAPES: Record<PieceType, readonly (readonly Cell[])[]> = (() => {
  const out = {} as Record<PieceType, Cell[][]>;
  for (const t of PIECE_TYPES) {
    const def = SPAWN_SHAPES[t];
    const states: Cell[][] = [def.cells];
    for (let r = 1; r < 4; r++) {
      states.push(t === PieceType.O ? def.cells : rotateCW(states[r - 1]!, def.size));
    }
    out[t] = states;
  }
  return out;
})();

/**
 * SRS 壁蹴りテーブル（ガイドライン表記：y は上が正）。
 * キー "from>to"。参照時に y の符号を反転して下向き座標系に合わせる。
 */
type KickTable = Record<string, readonly Cell[]>;

const JLSTZ_KICKS: KickTable = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const I_KICKS: KickTable = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

const NO_KICKS: readonly Cell[] = [[0, 0]];

function toDown(table: KickTable): KickTable {
  const out: Record<string, readonly Cell[]> = {};
  for (const [k, v] of Object.entries(table)) out[k] = v.map(([dx, dy]) => [dx, -dy] as const);
  return out;
}
const JLSTZ_KICKS_DOWN = toDown(JLSTZ_KICKS);
const I_KICKS_DOWN = toDown(I_KICKS);

/** KICKS[type][from][to] の事前計算表（回転のたびに文字列キーを作らない） */
const KICK_LOOKUP: (readonly Cell[])[][][] = PIECE_TYPES.reduce<(readonly Cell[])[][][]>((acc, t) => {
  acc[t] = [0, 1, 2, 3].map((from) =>
    [0, 1, 2, 3].map((to) => {
      if (t === PieceType.O) return NO_KICKS;
      const table = t === PieceType.I ? I_KICKS_DOWN : JLSTZ_KICKS_DOWN;
      return table[`${from}>${to}`] ?? NO_KICKS;
    }),
  );
  return acc;
}, []);

/** 下向き座標系に変換済みの壁蹴り候補を返す */
export function getKicks(type: PieceType, from: Rotation, to: Rotation): readonly Cell[] {
  return KICK_LOOKUP[type]![from]![to]!;
}

/** 出現時の x 座標（3x3 は 3〜5 列、I/O は 3〜6 列の箱） */
export const SPAWN_X = 3;
