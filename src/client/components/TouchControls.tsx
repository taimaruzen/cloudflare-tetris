import { useRef, type ReactNode } from 'react';
import type { Control } from '../game/input';
import type { GameApi } from '../game/useGame';
import { sound } from '../game/sound';

interface ButtonProps {
  control: Control;
  label: string;
  game: GameApi;
  children: ReactNode;
  className?: string;
}

/** 押している間だけ有効なボタン（長押しで連続移動） */
function PadButton({ control, label, game, children, className = '' }: ButtonProps) {
  const active = useRef<number | null>(null);
  return (
    <button
      type="button"
      aria-label={label}
      className={`pad-btn ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        sound.unlock();
        if (game.playing) {
          game.input.press(control);
          if (control === 'rotateCW' || control === 'rotateCCW') sound.play('rotate');
        }
        navigator.vibrate?.(8);
      }}
      onPointerUp={(e) => {
        if (active.current !== e.pointerId) return;
        active.current = null;
        game.input.release(control);
      }}
      onPointerCancel={(e) => {
        if (active.current !== e.pointerId) return;
        active.current = null;
        game.input.release(control);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** スマートフォン用の操作ボタン */
export function TouchControls({ game }: { game: GameApi }) {
  return (
    <div className="touch-controls grid w-full max-w-md grid-cols-[1fr_auto] gap-3 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
      <div className="grid grid-cols-3 grid-rows-2 gap-2">
        <PadButton control="hold" label="ホールド" game={game} className="text-xs font-bold">
          HOLD
        </PadButton>
        <PadButton control="hardDrop" label="ハードドロップ" game={game}>
          <Icon d="M12 4v12M6 12l6 6 6-6M5 21h14" />
        </PadButton>
        <PadButton control="rotateCCW" label="左回転" game={game}>
          <Icon d="M4 10a8 8 0 1 1 2 7M4 4v6h6" />
        </PadButton>
        <PadButton control="left" label="左移動" game={game}>
          <Icon d="M15 5l-7 7 7 7" />
        </PadButton>
        <PadButton control="softDrop" label="ソフトドロップ" game={game}>
          <Icon d="M5 9l7 7 7-7" />
        </PadButton>
        <PadButton control="right" label="右移動" game={game}>
          <Icon d="M9 5l7 7-7 7" />
        </PadButton>
      </div>
      <PadButton control="rotateCW" label="右回転" game={game} className="h-full w-20 rounded-full">
        <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 10a8 8 0 1 0-2 7M20 4v6h-6" />
        </svg>
      </PadButton>
    </div>
  );
}
