import { Action } from '../../engine';

/** 押しっぱなしで連続入力できる操作 */
export type HoldableControl = 'left' | 'right' | 'softDrop';
export type Control = HoldableControl | 'rotateCW' | 'rotateCCW' | 'hardDrop' | 'hold';

/** 長押しで連続移動が始まるまでのティック数（約167ms） */
export const DAS_TICKS = 10;
/** 連続移動の間隔（ティック） */
export const ARR_TICKS = 2;
/** ソフトドロップの間隔（ティック） */
export const SOFT_DROP_TICKS = 2;

const SINGLE_ACTION: Record<Exclude<Control, HoldableControl>, Action> = {
  rotateCW: Action.RotateCW,
  rotateCCW: Action.RotateCCW,
  hardDrop: Action.HardDrop,
  hold: Action.Hold,
};

/**
 * キーボード・タッチボタン・スワイプからの入力を、ティック単位のアクション列に変換する。
 * 長押し（DAS/ARR）の判定もティック単位で行うので、リプレイと完全に一致する。
 */
export class InputController {
  private queue: Action[] = [];
  private held = new Map<HoldableControl, number>();
  /** 左右を同時に押したときは後から押した方を優先する */
  private lastHorizontal: 'left' | 'right' | null = null;

  press(control: Control): void {
    if (control === 'left' || control === 'right' || control === 'softDrop') {
      if (this.held.has(control)) return;
      this.held.set(control, 0);
      if (control !== 'softDrop') this.lastHorizontal = control;
      this.queue.push(control === 'left' ? Action.Left : control === 'right' ? Action.Right : Action.SoftDrop);
      return;
    }
    this.queue.push(SINGLE_ACTION[control]);
  }

  release(control: Control): void {
    if (control === 'left' || control === 'right' || control === 'softDrop') {
      this.held.delete(control);
      if (this.lastHorizontal === control) {
        this.lastHorizontal = this.held.has('left') ? 'left' : this.held.has('right') ? 'right' : null;
        if (this.lastHorizontal) this.held.set(this.lastHorizontal, 0);
      }
    }
  }

  /** スワイプなど、長押し判定を通さない単発のアクション */
  push(action: Action): void {
    this.queue.push(action);
  }

  releaseAll(): void {
    this.held.clear();
    this.lastHorizontal = null;
  }

  clear(): void {
    this.queue = [];
    this.releaseAll();
  }

  /** 1ティック分の入力を取り出す（長押しの繰り返しもここで生成） */
  take(): Action[] {
    for (const [control, frames] of this.held) {
      const next = frames + 1;
      this.held.set(control, next);
      if (control === 'softDrop') {
        if (next % SOFT_DROP_TICKS === 0) this.queue.push(Action.SoftDrop);
      } else if (control === this.lastHorizontal && next >= DAS_TICKS && (next - DAS_TICKS) % ARR_TICKS === 0) {
        this.queue.push(control === 'left' ? Action.Left : Action.Right);
      }
    }
    const out = this.queue.slice(0, 8);
    this.queue = this.queue.slice(8);
    return out;
  }
}

/** キーボード割り当て */
export const KEY_MAP: Record<string, Control | 'pause'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'softDrop',
  ArrowUp: 'rotateCW',
  KeyX: 'rotateCW',
  KeyZ: 'rotateCCW',
  ControlLeft: 'rotateCCW',
  Space: 'hardDrop',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  KeyP: 'pause',
  Escape: 'pause',
};
