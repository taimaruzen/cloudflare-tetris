import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, ReplayRecorder, TICK_RATE, type GameStats, type PieceType, type Replay } from '../../engine';
import { InputController } from './input';
import { drawBoard, spawnClearParticles, type RenderState } from './renderer';
import { sound } from './sound';

export type GameStatus = 'idle' | 'playing' | 'paused' | 'over';

export interface Hud {
  score: number;
  lines: number;
  level: number;
  next: PieceType[];
  hold: PieceType | null;
  holdUsed: boolean;
}

export interface Session {
  sessionId: string;
  seed: string;
}

export interface GameResult {
  stats: GameStats;
  replay: Replay;
  session: Session | null;
}

export interface Callout {
  id: number;
  title: string;
  sub?: string;
}

const STEP_MS = 1000 / TICK_RATE;
const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

function hudOf(g: Game): Hud {
  return { score: g.score, lines: g.lines, level: g.level, next: g.next, hold: g.hold, holdUsed: g.holdUsed };
}

function sameHud(a: Hud, b: Hud): boolean {
  return (
    a.score === b.score &&
    a.lines === b.lines &&
    a.level === b.level &&
    a.hold === b.hold &&
    a.holdUsed === b.holdUsed &&
    a.next.length === b.next.length &&
    a.next.every((t, i) => t === b.next[i])
  );
}

function randomSeed(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface BoardView {
  canvas: HTMLCanvasElement | null;
  cell: number;
  dpr: number;
}

export function useGame(options: { ghost: boolean; onGameOver: (r: GameResult) => void }) {
  const gameRef = useRef<Game>(new Game('preview'));
  const recorderRef = useRef(new ReplayRecorder());
  const sessionRef = useRef<Session | null>(null);
  const inputRef = useRef(new InputController());
  const fxRef = useRef<RenderState>({ particles: [], shake: 0 });
  const viewRef = useRef<BoardView>({ canvas: null, cell: 24, dpr: 1 });
  const statusRef = useRef<GameStatus>('idle');
  const optsRef = useRef(options);
  optsRef.current = options;

  const [status, setStatusState] = useState<GameStatus>('idle');
  const [hud, setHud] = useState<Hud>(() => hudOf(gameRef.current));
  const [callout, setCallout] = useState<Callout | null>(null);
  const hudRef = useRef(hud);
  const calloutId = useRef(0);

  const setStatus = useCallback((s: GameStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const showCallout = useCallback((title: string, sub?: string) => {
    const id = ++calloutId.current;
    setCallout({ id, title, sub });
    window.setTimeout(() => setCallout((c) => (c?.id === id ? null : c)), 1200);
  }, []);

  /** 1ティック進める */
  const tick = useCallback(() => {
    const game = gameRef.current;
    let actions = inputRef.current.take();
    if (game.clearing) actions = [];
    const t = game.ticks + 1;
    for (const a of actions) recorderRef.current.record(t, a);
    game.step(actions);

    for (const e of game.events) {
      switch (e.kind) {
        case 'lock':
          sound.play('lock');
          break;
        case 'hardDrop':
          sound.play('hardDrop');
          fxRef.current.shake = Math.min(10, 2 + e.distance * 0.4);
          break;
        case 'hold':
          sound.play('hold');
          break;
        case 'clear': {
          sound.play(e.lines === 4 ? 'quad' : 'clear');
          spawnClearParticles(fxRef.current, game, e.rows, viewRef.current.cell);
          const parts = [e.b2b ? 'BACK-TO-BACK' : '', e.combo > 0 ? `${e.combo} COMBO` : ''].filter(Boolean);
          showCallout(CLEAR_NAMES[e.lines] ?? '', [`+${e.points}`, ...parts].join('  '));
          break;
        }
        case 'levelUp':
          sound.play('levelUp');
          showCallout(`LEVEL ${e.level}`);
          break;
        case 'gameOver':
          sound.play('gameOver');
          break;
      }
    }

    const next = hudOf(game);
    if (!sameHud(next, hudRef.current)) {
      hudRef.current = next;
      setHud(next);
    }

    if (game.over) {
      inputRef.current.clear();
      setStatus('over');
      optsRef.current.onGameOver({
        stats: game.stats,
        replay: recorderRef.current.finish(game.ticks),
        session: sessionRef.current,
      });
    }
  }, [setStatus, showCallout]);

  // 描画とゲームループ（固定ステップ）
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      if (statusRef.current === 'playing') {
        acc += Math.min(dt, 250);
        while (acc >= STEP_MS && statusRef.current === 'playing') {
          acc -= STEP_MS;
          tick();
        }
      } else {
        acc = 0;
      }
      const v = viewRef.current;
      const ctx = v.canvas?.getContext('2d');
      if (ctx) drawBoard(ctx, gameRef.current, v.cell, v.dpr, fxRef.current, optsRef.current.ghost);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  const start = useCallback(
    (session: Session | null) => {
      sound.unlock();
      sessionRef.current = session;
      gameRef.current = new Game(session?.seed ?? randomSeed());
      recorderRef.current = new ReplayRecorder();
      inputRef.current.clear();
      fxRef.current = { particles: [], shake: 0 };
      hudRef.current = hudOf(gameRef.current);
      setHud(hudRef.current);
      setCallout(null);
      setStatus('playing');
    },
    [setStatus],
  );

  const pause = useCallback(() => {
    if (statusRef.current === 'playing') {
      inputRef.current.releaseAll();
      setStatus('paused');
    }
  }, [setStatus]);

  const resume = useCallback(() => {
    if (statusRef.current === 'paused') {
      sound.unlock();
      setStatus('playing');
    }
  }, [setStatus]);

  const togglePause = useCallback(() => {
    if (statusRef.current === 'playing') pause();
    else if (statusRef.current === 'paused') resume();
  }, [pause, resume]);

  /** ゲームを中断してタイトルへ（記録は送信しない） */
  const abort = useCallback(() => {
    inputRef.current.clear();
    sessionRef.current = null;
    gameRef.current = new Game('preview');
    hudRef.current = hudOf(gameRef.current);
    setHud(hudRef.current);
    setStatus('idle');
  }, [setStatus]);

  // タブを離れたら自動で一時停止
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) pause();
    };
    const onBlur = () => pause();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
    };
  }, [pause]);

  return {
    status,
    hud,
    callout,
    input: inputRef.current,
    viewRef,
    start,
    pause,
    resume,
    togglePause,
    abort,
    get playing() {
      return statusRef.current === 'playing';
    },
  };
}

export type GameApi = ReturnType<typeof useGame>;
