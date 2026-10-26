import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Action,
  CLEAR_DELAY,
  COLS,
  Game,
  HIDDEN_ROWS,
  LOCK_DELAY,
  PieceType,
  ROWS,
  Rng,
  SHAPES,
  SevenBag,
  hashSeed,
} from '../src/engine';

const { I, O, T } = PieceType;

function rowFilled(g: Game, y: number): number {
  let n = 0;
  for (let x = 0; x < COLS; x++) if (g.cell(x, y)) n++;
  return n;
}

/** ライン消去アニメーションを最後まで進める */
function finishClear(g: Game): void {
  for (let i = 0; i < CLEAR_DELAY; i++) g.step();
}

describe('7-bag 抽選', () => {
  it('7個ごとに全種類が1回ずつ出る', () => {
    const bag = new SevenBag(new Rng(hashSeed('bag-test')));
    for (let round = 0; round < 50; round++) {
      const set = new Set<number>();
      for (let i = 0; i < 7; i++) set.add(bag.next());
      assert.equal(set.size, 7);
    }
  });

  it('同じシードなら同じ順番になる', () => {
    const a = new SevenBag(new Rng(hashSeed('same')));
    const b = new SevenBag(new Rng(hashSeed('same')));
    const c = new SevenBag(new Rng(hashSeed('other')));
    const sa = Array.from({ length: 70 }, () => a.next());
    const sb = Array.from({ length: 70 }, () => b.next());
    const sc = Array.from({ length: 70 }, () => c.next());
    assert.deepEqual(sa, sb);
    assert.notDeepEqual(sa, sc);
  });

  it('NEXT は5個表示される', () => {
    const g = new Game('next');
    assert.equal(g.next.length, 5);
  });
});

describe('SRS 回転', () => {
  it('各ブロックは4つの回転状態を持ち、4回転で元に戻る', () => {
    for (const t of [1, 2, 3, 4, 5, 6, 7] as const) {
      assert.equal(SHAPES[t].length, 4);
      for (const s of SHAPES[t]) assert.equal(s.length, 4);
    }
    const g = new Game('rot');
    g.loadBoard([]);
    g.setActive(T, 4, 10);
    for (let i = 0; i < 4; i++) g.step([Action.RotateCW]);
    assert.equal(g.active!.rot, 0);
    assert.equal(g.active!.x, 4);
  });

  it('T の右回転は (1,0),(1,1),(2,1),(1,2) の形になる', () => {
    const cells = SHAPES[T][1]!.map(([x, y]) => `${x},${y}`).sort();
    assert.deepEqual(cells, ['1,0', '1,1', '1,2', '2,1']);
  });

  it('左回転は右回転の逆になる', () => {
    const g = new Game('ccw');
    g.loadBoard([]);
    g.setActive(T, 4, 10);
    g.step([Action.RotateCW, Action.RotateCCW]);
    assert.equal(g.active!.rot, 0);
  });

  it('O は回転しても位置が変わらない', () => {
    const g = new Game('o');
    g.loadBoard([]);
    g.setActive(O, 4, 10);
    g.step([Action.RotateCW]);
    assert.equal(g.active!.x, 4);
    assert.equal(g.active!.y, 10);
  });

  it('壁蹴り：左壁に接した縦の T を回転すると右へ1マス蹴られる', () => {
    const g = new Game('kick-t');
    g.loadBoard([]);
    g.setActive(T, -1, 10, 1); // 状態R、セルは列0〜1
    g.step([Action.RotateCW]); // R→2 は列-1にはみ出すので (+1,0) で蹴られる
    assert.equal(g.active!.rot, 2);
    assert.equal(g.active!.x, 0);
  });

  it('壁蹴り：左壁に接した縦の I は I 専用テーブルで蹴られる', () => {
    const g = new Game('kick-i');
    g.loadBoard([]);
    g.setActive(I, -2, 10, 1); // 状態R、セルは列0
    g.step([Action.RotateCW]); // R→2：(0,0),(-1,0) は失敗、(+2,0) で成功
    assert.equal(g.active!.rot, 2);
    assert.equal(g.active!.x, 0);
  });

  it('どの蹴り位置も塞がっていれば回転しない', () => {
    const g = new Game('blocked');
    // 縦 I の左右を完全に塞ぐ
    const rows = Array.from({ length: 12 }, () => '########..'.slice(0, 8) + '.#');
    g.loadBoard(rows);
    g.setActive(I, 6, ROWS - 4, 1); // 列8に縦置き
    const before = { ...g.active! };
    g.step([Action.RotateCW]);
    assert.equal(g.active!.rot, before.rot);
    assert.equal(g.active!.x, before.x);
  });
});

describe('移動・落下・固定', () => {
  it('壁より外には移動できない', () => {
    const g = new Game('wall');
    g.loadBoard([]);
    g.setActive(O, 3, 10);
    for (let i = 0; i < 10; i++) g.step([Action.Left]);
    assert.equal(g.active!.x, -1); // O の箱は列1から始まるので x=-1 で列0
    for (let i = 0; i < 20; i++) g.step([Action.Right]);
    assert.equal(g.active!.x, 7);
  });

  it('レベル1では約1秒（61ティック）で1段落ちる', () => {
    const g = new Game('gravity');
    g.loadBoard([]);
    g.setActive(T, 4, 5);
    for (let i = 0; i < 60; i++) g.step();
    assert.equal(g.active!.y, 5);
    g.step();
    assert.equal(g.active!.y, 6);
  });

  it('ソフトドロップは1マスにつき1点', () => {
    const g = new Game('soft');
    g.loadBoard([]);
    g.setActive(T, 4, 5);
    g.step([Action.SoftDrop, Action.SoftDrop, Action.SoftDrop]);
    assert.equal(g.active!.y, 8);
    assert.equal(g.score, 3);
  });

  it('ハードドロップは1マスにつき2点で即固定される', () => {
    const g = new Game('hard');
    g.loadBoard([]);
    g.setActive(O, 3, 2);
    g.step([Action.HardDrop]);
    // O は箱の 0〜1 行目にあるので y=ROWS-2 で着地 → 距離 ROWS-4
    assert.equal(g.score, (ROWS - 4) * 2);
    assert.equal(g.cell(4, ROWS - 1), O);
    assert.equal(g.cell(5, ROWS - 2), O);
    assert.equal(g.pieces, 1);
  });

  it('ゴーストブロックは着地位置を示す', () => {
    const g = new Game('ghost');
    g.loadBoard(['#.........']);
    g.setActive(O, 3, 2);
    assert.equal(g.ghostY(), ROWS - 2);
  });

  it('接地後 LOCK_DELAY ティックで固定される', () => {
    const g = new Game('lock');
    g.loadBoard([]);
    g.setActive(O, 3, ROWS - 2);
    for (let i = 0; i < LOCK_DELAY - 1; i++) g.step();
    assert.equal(g.pieces, 0);
    g.step();
    assert.equal(g.pieces, 1);
  });

  it('接地中の移動で固定猶予がリセットされるが、15回が上限', () => {
    const g = new Game('reset');
    g.loadBoard([]);
    g.setActive(T, 3, ROWS - 2);
    let ticks = 0;
    for (let i = 0; i < 40 && g.pieces === 0; i++) {
      for (let k = 0; k < 10 && g.pieces === 0; k++) {
        g.step();
        ticks++;
      }
      if (g.pieces === 0) g.step([i % 2 ? Action.Left : Action.Right]);
      ticks++;
    }
    assert.equal(g.pieces, 1);
    assert.ok(ticks < 15 * 11 + LOCK_DELAY + 5, `ticks=${ticks}`);
    assert.ok(ticks > LOCK_DELAY, `ticks=${ticks}`);
  });
});

describe('ライン消去とスコア', () => {
  it('1ライン消去：100 × レベル', () => {
    const g = new Game('single');
    g.loadBoard(['....######']);
    g.setActive(I, 0, ROWS - 2); // I 状態0 は箱の1行目 → 最下段（落下距離0）
    g.step([Action.HardDrop]);
    assert.equal(g.lines, 1);
    assert.equal(g.score, 100);
    assert.ok(g.clearing);
    finishClear(g);
    assert.equal(g.clearing, null);
    assert.equal(rowFilled(g, ROWS - 1), 0);
    assert.ok(g.active, '次のブロックが出現する');
  });

  it('消えた行より上のブロックは下に詰める', () => {
    const g = new Game('collapse');
    g.loadBoard(['#.........', '....######']);
    g.setActive(I, 0, ROWS - 2);
    g.step([Action.HardDrop]);
    finishClear(g);
    assert.notEqual(g.cell(0, ROWS - 1), 0);
    assert.equal(rowFilled(g, ROWS - 1), 1);
  });

  it('4ライン消去は800点、連続4ライン（Back-to-Back）は1.5倍、コンボ加点あり', () => {
    const g = new Game('tetris');
    const four = ['#########.', '#########.', '#########.', '#########.'];
    g.loadBoard([...four, ...four]);
    g.setActive(I, 7, 2, 1); // 縦 I を列9へ
    g.step([Action.HardDrop]);
    const drop1 = g.score - 800;
    assert.equal(g.lines, 4);
    assert.ok(drop1 >= 0);
    finishClear(g);

    const before = g.score;
    g.setActive(I, 7, 2, 1);
    g.step([Action.HardDrop]);
    const gained = g.score - before;
    const drop2 = (ROWS - 4 - 2) * 2;
    // 2回目は B2B 1200 + コンボ1 (50×1×レベル1) + ハードドロップ
    assert.equal(gained, 1200 + 50 + drop2);
    assert.equal(g.lines, 8);
  });

  it('2・3ライン消去は300・500点', () => {
    const g2 = new Game('double');
    g2.loadBoard(['#########.', '#########.']);
    g2.setActive(I, 7, 2, 1);
    const d0 = g2.score;
    g2.step([Action.HardDrop]);
    assert.equal(g2.lines, 2);
    assert.equal(g2.score - d0, 300 + (ROWS - 6) * 2);

    const g3 = new Game('triple');
    g3.loadBoard(['#########.', '#########.', '#########.']);
    g3.setActive(I, 7, 2, 1);
    const s0 = g3.score;
    g3.step([Action.HardDrop]);
    assert.equal(g3.lines, 3);
    const dist = ROWS - 6; // 縦 I（y=2）が最下段（y=ROWS-4）に着くまで
    assert.equal(g3.score - s0, 500 + dist * 2);
  });

  it('10ラインごとにレベルが上がり、得点にレベルが掛かる', () => {
    const g = new Game('level');
    for (let round = 0; round < 3; round++) {
      g.loadBoard(['#########.', '#########.', '#########.', '#########.']);
      g.setActive(I, 7, 2, 1);
      g.step([Action.HardDrop]);
      finishClear(g);
    }
    assert.equal(g.lines, 12);
    assert.equal(g.level, 2);
    g.loadBoard(['....######']);
    g.setActive(I, 0, ROWS - 2);
    const before = g.score;
    g.step([Action.HardDrop]);
    // B2B は途切れ、コンボは継続中（3）→ 100×2 + 50×3×2
    assert.equal(g.score - before, 200 + 300);
  });
});

describe('ホールド', () => {
  it('ホールドすると現在のブロックが保存され、次のブロックが出る', () => {
    const g = new Game('hold');
    const first = g.active!.type;
    const nextType = g.next[0];
    g.step([Action.Hold]);
    assert.equal(g.hold, first);
    assert.equal(g.active!.type, nextType);
  });

  it('1回のブロックにつき1度しかホールドできない', () => {
    const g = new Game('hold-once');
    g.step([Action.Hold]);
    const t = g.active!.type;
    g.step([Action.Hold]);
    assert.equal(g.active!.type, t);
  });

  it('固定後は再びホールドでき、保存したブロックと入れ替わる', () => {
    const g = new Game('hold-swap');
    const first = g.active!.type;
    g.step([Action.Hold]);
    g.step([Action.HardDrop]);
    g.step([Action.Hold]);
    assert.equal(g.active!.type, first);
  });
});

describe('ゲームオーバー', () => {
  it('出現位置が塞がっているとゲームオーバー（ブロックアウト）', () => {
    const g = new Game('blockout');
    // 出現位置（列3〜6）を1行目まで塞ぎ、O は左端の空き列に落とす
    g.loadBoard(Array.from({ length: ROWS - 1 }, () => '...####...'));
    g.setActive(O, -1, ROWS - 2);
    g.step([Action.HardDrop]);
    assert.ok(g.over);
    assert.equal(g.overReason, 'blockOut');
  });

  it('非表示領域だけで固定されるとゲームオーバー（ロックアウト）', () => {
    const g = new Game('lockout');
    const rows = Array.from({ length: ROWS - HIDDEN_ROWS }, () => '#.#.#.#.#.');
    g.loadBoard(rows);
    g.setActive(O, 3, 0);
    g.step([Action.HardDrop]);
    assert.ok(g.over);
    assert.equal(g.overReason, 'lockOut');
  });

  it('ゲームオーバー後は step しても状態が変わらない', () => {
    const g = new Game('frozen');
    g.loadBoard(Array.from({ length: ROWS - HIDDEN_ROWS }, () => '...####...'));
    g.setActive(O, 3, 0);
    g.step([Action.HardDrop]);
    assert.ok(g.over);
    const s = g.stats;
    g.step([Action.HardDrop]);
    assert.deepEqual(g.stats, s);
  });

  it('何もしなければいずれ積み上がってゲームオーバーになる', () => {
    const g = new Game('idle');
    let i = 0;
    while (!g.over && i < 200000) {
      g.step();
      i++;
    }
    assert.ok(g.over);
  });
});
