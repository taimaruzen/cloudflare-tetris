import { useCallback, useEffect, useState } from 'react';
import type { SubmitScoreResponse } from '../shared/api-types';
import { ApiError, api, loadPlayer, loadSettings, savePlayer, saveSettings, type Settings, type StoredPlayer } from './api';
import { Board } from './components/Board';
import { Preview } from './components/Preview';
import { PlayerSetup } from './components/PlayerSetup';
import { RankingPanel, formatDuration } from './components/RankingPanel';
import { TouchControls } from './components/TouchControls';
import { KEY_MAP } from './game/input';
import { sound } from './game/sound';
import { useGame, type GameResult, type Hud } from './game/useGame';
import { TICK_RATE } from '../engine';

type Submission =
  | { state: 'none' }
  | { state: 'guest' }
  | { state: 'sending' }
  | { state: 'done'; res: SubmitScoreResponse }
  | { state: 'error'; message: string };

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`neon-num stat-value ${accent}`}>{value}</div>
    </div>
  );
}

function HoldBox({ hud, size }: { hud: Hud; size: number }) {
  return (
    <div className="panel items-center">
      <h2 className="panel-title">HOLD</h2>
      <Preview type={hud.hold} width={size} height={size * 0.62} dimmed={hud.holdUsed} />
    </div>
  );
}

function NextBox({ hud, size, count }: { hud: Hud; size: number; count: number }) {
  return (
    <div className="panel items-center">
      <h2 className="panel-title">NEXT</h2>
      <Preview type={hud.next[0] ?? null} width={size} height={size * 0.62} />
      {hud.next.slice(1, count).map((t, i) => (
        <Preview key={i} type={t} width={size * 0.72} height={size * 0.45} className="opacity-80" />
      ))}
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<StoredPlayer | null>(() => loadPlayer());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ state: 'none' });
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [rankingKey, setRankingKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'game' | 'ranking'>('game');

  const touch = useMediaQuery('(pointer: coarse)');
  const narrow = useMediaQuery('(max-width: 1023px)');

  useEffect(() => {
    sound.muted = settings.muted;
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setOnline(h.ok);
        setSiteKey(h.turnstileSiteKey);
      })
      .catch(() => setOnline(false));
  }, []);

  const onGameOver = useCallback(
    (result: GameResult) => {
      setLastResult(result);
      if (!result.session || !me) {
        setSubmission({ state: 'guest' });
        return;
      }
      setSubmission({ state: 'sending' });
      api
        .submitScore(me.token, {
          sessionId: result.session.sessionId,
          replay: result.replay,
          claimed: { score: result.stats.score, lines: result.stats.lines, level: result.stats.level },
        })
        .then((res) => {
          setSubmission({ state: 'done', res });
          setRankingKey((k) => k + 1);
        })
        .catch((e: unknown) => setSubmission({ state: 'error', message: e instanceof Error ? e.message : '送信に失敗しました' }));
    },
    [me],
  );

  const game = useGame({ ghost: settings.ghost, onGameOver });

  const startGame = useCallback(async () => {
    if (starting) return;
    sound.unlock();
    setStarting(true);
    setNotice(null);
    setSubmission({ state: 'none' });
    setMobileView('game');
    let session = null;
    if (me) {
      try {
        session = await api.startGame(me.token);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          savePlayer(null);
          setMe(null);
          setNotice('プレイヤー情報が無効になったため、ゲストでプレイします');
        } else {
          setNotice('サーバーに接続できないため、記録は保存されません');
        }
      }
    }
    setStarting(false);
    game.start(session);
  }, [me, starting, game]);

  // キーボード操作
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const c = KEY_MAP[e.code];
      if (!c) {
        if ((e.code === 'Enter' || e.code === 'KeyR') && (game.status === 'idle' || game.status === 'over') && !showSetup) {
          e.preventDefault();
          void startGame();
        }
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      if (c === 'pause') {
        game.togglePause();
        return;
      }
      if (game.status === 'idle' || game.status === 'over') {
        // ゲームオーバー直後の連打で結果画面を飛ばさないよう、Space で開始できるのはタイトル画面だけ
        if (c === 'hardDrop' && game.status === 'idle' && !showSetup) void startGame();
        return;
      }
      if (!game.playing) return;
      if (c === 'rotateCW' || c === 'rotateCCW') sound.play('rotate');
      game.input.press(c);
    };
    const up = (e: KeyboardEvent) => {
      const c = KEY_MAP[e.code];
      if (c && c !== 'pause') game.input.release(c);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [game, startGame, showSetup]);

  const { hud, status } = game;
  const previewSize = narrow ? 64 : 104;

  const logout = () => {
    if (!confirm('この端末のプレイヤー情報を削除しますか？（ランキングの記録は残ります）')) return;
    savePlayer(null);
    setMe(null);
  };

  const overlay = (
    <>
      {status === 'idle' && (
        <div className="overlay">
          <div className="overlay-card">
            <h1 className="logo text-4xl sm:text-5xl">
              NEON<span className="text-fuchsia-400">DROP</span>
            </h1>
            <p className="mt-1 text-xs tracking-[0.3em] text-cyan-200/70">ONLINE BLOCK PUZZLE</p>
            {showSetup ? (
              <div className="mt-6">
                <PlayerSetup
                  turnstileSiteKey={siteKey}
                  onRegistered={(p) => {
                    setMe(p);
                    setShowSetup(false);
                    setRankingKey((k) => k + 1);
                  }}
                  onCancel={() => setShowSetup(false)}
                />
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <button type="button" className="btn-neon w-full text-lg" onClick={() => void startGame()} disabled={starting}>
                  {starting ? '準備中…' : 'START'}
                </button>
                {me ? (
                  <p className="text-sm text-white/70">
                    <span className="text-cyan-200">{me.player.nickname}</span> としてランキングに参加中
                  </p>
                ) : (
                  <button type="button" className="btn-ghost w-full" onClick={() => setShowSetup(true)} disabled={online === false}>
                    ニックネームを登録してランキングに参加
                  </button>
                )}
                {online === false && <p className="text-xs text-rose-300">サーバーに接続できません（オフラインで遊べます）</p>}
                <p className="hidden text-[11px] leading-relaxed text-white/50 sm:block">
                  ← → 移動 / ↑ 回転（Z 左回転）/ ↓ 高速落下 / Space ハードドロップ / C ホールド / P 一時停止
                </p>
                <p className="text-[11px] leading-relaxed text-white/50 sm:hidden">
                  ボタン操作のほか、フィールドを横スワイプで移動・タップで回転・下に払うとハードドロップ・上に払うとホールド
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {status === 'paused' && (
        <div className="overlay">
          <div className="overlay-card">
            <h2 className="logo text-3xl">PAUSE</h2>
            <div className="mt-6 space-y-3">
              <button type="button" className="btn-neon w-full" onClick={game.resume}>
                再開
              </button>
              <button type="button" className="btn-ghost w-full" onClick={() => void startGame()}>
                リスタート
              </button>
              <button type="button" className="btn-ghost w-full" onClick={game.abort}>
                タイトルへ
              </button>
            </div>
          </div>
        </div>
      )}
      {status === 'over' && lastResult && (
        <div className="overlay">
          <div className="overlay-card">
            <h2 className="logo text-3xl text-rose-300">GAME OVER</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 text-left">
              <Stat label="SCORE" value={lastResult.stats.score.toLocaleString()} accent="text-cyan-200" />
              <Stat label="LEVEL" value={lastResult.stats.level} accent="text-fuchsia-300" />
              <Stat label="LINES" value={lastResult.stats.lines} accent="text-lime-300" />
              <Stat
                label="TIME"
                value={formatDuration((lastResult.stats.ticks * 1000) / TICK_RATE)}
                accent="text-amber-200"
              />
            </div>
            <div className="mt-4 min-h-[3rem] text-sm">
              {submission.state === 'sending' && <p className="text-cyan-200">記録を検証中…</p>}
              {submission.state === 'done' && (
                <p className="text-white/80">
                  {submission.res.personalBest && <span className="mr-2 font-bold text-yellow-300">自己ベスト更新！</span>}
                  全期間ランキング <span className="neon-num text-xl text-fuchsia-300">{submission.res.rank}</span> 位
                </p>
              )}
              {submission.state === 'error' && <p className="text-rose-300">{submission.message}</p>}
              {submission.state === 'guest' && (
                <p className="text-white/60">ゲストプレイのため記録は保存されません</p>
              )}
            </div>
            <div className="mt-2 space-y-3">
              <button type="button" className="btn-neon w-full" onClick={() => void startGame()} disabled={starting}>
                RETRY
              </button>
              <button type="button" className="btn-ghost w-full" onClick={game.abort}>
                タイトルへ
              </button>
            </div>
          </div>
        </div>
      )}
      {game.callout && status === 'playing' && (
        <div key={game.callout.id} className="callout pointer-events-none absolute inset-x-0 top-1/3 text-center">
          <div className="logo text-3xl text-white">{game.callout.title}</div>
          {game.callout.sub && <div className="mt-1 text-sm font-bold tracking-widest text-yellow-200">{game.callout.sub}</div>}
        </div>
      )}
    </>
  );

  const gameButtons = (
    <div className="flex gap-2">
      <button
        type="button"
        className="icon-btn"
        aria-label={status === 'paused' ? '再開' : '一時停止'}
        onClick={game.togglePause}
        disabled={status !== 'playing' && status !== 'paused'}
      >
        {status === 'paused' ? '▶' : 'Ⅱ'}
      </button>
      <button type="button" className="icon-btn" aria-label="リスタート" onClick={() => void startGame()} disabled={starting}>
        ↻
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={settings.muted ? '音を出す' : 'ミュート'}
        onClick={() => setSettings((s) => ({ ...s, muted: !s.muted }))}
      >
        {settings.muted ? '🔇' : '🔊'}
      </button>
    </div>
  );

  return (
    <div className="app-bg flex h-dvh flex-col overflow-hidden text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="logo text-xl">
          NEON<span className="text-fuchsia-400">DROP</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {narrow && (
            <button
              type="button"
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => {
                if (mobileView === 'game') game.pause();
                setMobileView((v) => (v === 'game' ? 'ranking' : 'game'));
              }}
            >
              {mobileView === 'game' ? 'ランキング' : 'ゲームに戻る'}
            </button>
          )}
          {me ? (
            <button type="button" className="max-w-[9rem] truncate text-cyan-200/80 hover:text-cyan-100" onClick={logout} title="プレイヤー情報を削除">
              {me.player.nickname}
            </button>
          ) : (
            <span className="text-white/50">GUEST</span>
          )}
        </div>
      </header>

      {notice && (
        <div className="mx-auto mb-1 rounded-md bg-amber-400/10 px-3 py-1 text-xs text-amber-200" role="status">
          {notice}
        </div>
      )}

      <main className="flex min-h-0 flex-1 justify-center gap-4 px-2 pb-2 lg:px-6">
        {narrow ? (
          mobileView === 'ranking' ? (
            <div className="flex w-full max-w-md min-h-0 flex-col">
              <RankingPanel me={me} refreshKey={rankingKey} />
            </div>
          ) : (
            <div className="flex w-full max-w-md min-h-0 flex-col items-center">
              <div className="flex w-full items-stretch justify-between gap-2">
                <HoldBox hud={hud} size={previewSize} />
                <div className="grid flex-1 grid-cols-3 gap-1 self-center">
                  <Stat label="SCORE" value={hud.score.toLocaleString()} accent="text-cyan-200" />
                  <Stat label="LEVEL" value={hud.level} accent="text-fuchsia-300" />
                  <Stat label="LINES" value={hud.lines} accent="text-lime-300" />
                  <div className="col-span-3 flex justify-center pt-1">{gameButtons}</div>
                </div>
                <NextBox hud={hud} size={previewSize} count={2} />
              </div>
              <div className="min-h-0 w-full flex-1 py-2">
                <Board game={game}>{overlay}</Board>
              </div>
              {(touch || narrow) && <TouchControls game={game} />}
            </div>
          )
        ) : (
          <>
            <div className="flex w-44 flex-col gap-3 pt-2">
              <HoldBox hud={hud} size={previewSize} />
              <div className="panel gap-3">
                <Stat label="SCORE" value={hud.score.toLocaleString()} accent="text-cyan-200" />
                <Stat label="LEVEL" value={hud.level} accent="text-fuchsia-300" />
                <Stat label="LINES" value={hud.lines} accent="text-lime-300" />
              </div>
              <div className="panel">{gameButtons}</div>
              <label className="flex items-center gap-2 px-1 text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={settings.ghost}
                  onChange={(e) => setSettings((s) => ({ ...s, ghost: e.target.checked }))}
                />
                ゴースト表示
              </label>
            </div>
            <div className="min-h-0 w-full max-w-[min(46vh,520px)] flex-1 py-2">
              <Board game={game}>{overlay}</Board>
            </div>
            <div className="flex w-44 flex-col gap-3 pt-2">
              <NextBox hud={hud} size={previewSize} count={5} />
            </div>
            <div className="hidden w-80 min-h-0 flex-col py-2 xl:flex">
              <RankingPanel me={me} refreshKey={rankingKey} />
            </div>
          </>
        )}
      </main>
      {!narrow && (
        <div className="px-6 pb-3 xl:hidden">
          <div className="mx-auto max-w-3xl">
            <details className="panel">
              <summary className="cursor-pointer text-sm text-cyan-200">ランキングを表示</summary>
              <div className="mt-2 h-80">
                <RankingPanel me={me} refreshKey={rankingKey} compact />
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
