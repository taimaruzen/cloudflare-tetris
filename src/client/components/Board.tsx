import { useEffect, useRef, type ReactNode } from 'react';
import { Action, COLS, VISIBLE_ROWS } from '../../engine';
import type { GameApi } from '../game/useGame';

interface Props {
  game: GameApi;
  children?: ReactNode;
}

/**
 * メインフィールド。親要素の大きさに合わせてマスの大きさを決め、Canvas に描画する。
 * フィールド上のスワイプ操作もここで処理する。
 */
export function Board({ game, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const frame = frameRef.current!;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const cell = Math.max(10, Math.floor(Math.min(rect.width / COLS, rect.height / VISIBLE_ROWS)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cell * COLS;
      const h = cell * VISIBLE_ROWS;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      frame.style.width = `${w}px`;
      frame.style.height = `${h}px`;
      game.viewRef.current = { canvas, cell, dpr };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [game.viewRef]);

  // ---- スワイプ操作：横ドラッグで移動、下ドラッグでソフトドロップ、
  //      素早く下に払うとハードドロップ、上に払うとホールド、タップで回転
  useEffect(() => {
    const el = canvasRef.current!;
    let id: number | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let startT = 0;
    let movedX = 0;
    let movedY = 0;
    let dragged = false;
    let samples: { y: number; t: number }[] = [];

    const cell = () => game.viewRef.current.cell;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || id !== null || !game.playing) return;
      id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      startT = performance.now();
      movedX = movedY = 0;
      dragged = false;
      samples = [{ y: e.clientY, t: startT }];
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id || !game.playing) return;
      const step = cell() * 0.9;
      movedX += e.clientX - lastX;
      movedY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const now = performance.now();
      samples.push({ y: e.clientY, t: now });
      while (samples.length > 2 && now - samples[0]!.t > 80) samples.shift();
      while (Math.abs(movedX) >= step) {
        game.input.push(movedX > 0 ? Action.Right : Action.Left);
        movedX -= Math.sign(movedX) * step;
        dragged = true;
      }
      while (movedY >= step) {
        game.input.push(Action.SoftDrop);
        movedY -= step;
        dragged = true;
      }
      if (movedY < 0) movedY = Math.max(movedY, -step * 3);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!game.playing) return;
      const now = performance.now();
      const dt = now - startT;
      const totalX = e.clientX - startX;
      const totalY = e.clientY - startY;
      const first = samples[0]!;
      const vy = (e.clientY - first.y) / Math.max(1, now - first.t); // px/ms
      if (vy > 1.1 && totalY > cell() * 1.5) {
        game.input.push(Action.HardDrop);
      } else if (vy < -0.9 && totalY < -cell() * 1.5) {
        game.input.push(Action.Hold);
      } else if (!dragged && dt < 300 && Math.abs(totalX) < 12 && Math.abs(totalY) < 12) {
        // 画面の左半分タップで左回転、右半分で右回転
        const rect = el.getBoundingClientRect();
        game.input.push(e.clientX - rect.left < rect.width / 2 ? Action.RotateCCW : Action.RotateCW);
      }
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === id) id = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [game]);

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center">
      <div ref={frameRef} className="board-frame relative">
        <canvas
          ref={canvasRef}
          className="block touch-none select-none"
          aria-label="ゲームフィールド"
          role="img"
        />
        {children}
      </div>
    </div>
  );
}
