import { useEffect, useRef } from 'react';
import type { PieceType } from '../../engine';
import { drawPreview } from '../game/renderer';

interface Props {
  type: PieceType | null;
  width: number;
  height: number;
  dimmed?: boolean;
  className?: string;
}

/** NEXT / HOLD のブロック表示 */
export function Preview({ type, width, height, dimmed, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    drawPreview(c.getContext('2d')!, type, width, height, dpr, dimmed);
  }, [type, width, height, dimmed]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
