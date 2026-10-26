import { PIECE_TYPES, type PieceType } from './pieces';

/** 文字列シードを 32bit 整数に変換（FNV-1a） */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: 整数演算のみの決定的な疑似乱数 */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** 0 以上 n 未満の整数（剰余の偏りを除去） */
  nextInt(n: number): number {
    const limit = Math.floor(0x100000000 / n) * n;
    let v: number;
    do v = this.nextU32();
    while (v >= limit);
    return v % n;
  }
}

/** 7-bag 方式：7種を1セットとしてシャッフルして順に出す */
export class SevenBag {
  private bag: PieceType[] = [];
  constructor(private readonly rng: Rng) {}
  next(): PieceType {
    if (this.bag.length === 0) {
      const b = [...PIECE_TYPES];
      for (let i = b.length - 1; i > 0; i--) {
        const j = this.rng.nextInt(i + 1);
        [b[i], b[j]] = [b[j]!, b[i]!];
      }
      this.bag = b;
    }
    return this.bag.shift()!;
  }
}
