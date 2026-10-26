import { useCallback, useEffect, useState } from 'react';
import type { PlayerProfileResponse, RankingPeriod, RankingResponse } from '../../shared/api-types';
import { api, type StoredPlayer } from '../api';

const TABS: { key: RankingPeriod; label: string }[] = [
  { key: 'all', label: '全期間' },
  { key: 'weekly', label: '週間' },
  { key: 'daily', label: '日間' },
];

interface Props {
  me: StoredPlayer | null;
  /** 値が変わるたびに再読み込みする */
  refreshKey: number;
  compact?: boolean;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function RankingPanel({ me, refreshKey, compact }: Props) {
  const [period, setPeriod] = useState<RankingPeriod>('all');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [profile, setProfile] = useState<PlayerProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p] = await Promise.all([
        api.rankings(period, compact ? 10 : 50),
        me ? api.player(me.player.id).catch(() => null) : Promise.resolve(null),
      ]);
      setData(r);
      setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [period, me, compact]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="panel flex min-h-0 flex-col" aria-label="ランキング">
      <div className="flex items-center justify-between gap-2">
        <h2 className="panel-title">RANKING</h2>
        <button type="button" className="text-xs text-cyan-300/70 hover:text-cyan-200" onClick={() => void load()}>
          更新
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={period === t.key}
            onClick={() => setPeriod(t.key)}
            className={`rounded-md py-1 text-xs font-bold tracking-wider transition ${
              period === t.key ? 'bg-fuchsia-500/30 text-white shadow-[0_0_12px_rgba(217,70,239,0.6)]' : 'text-white/60 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {profile?.best && (
        <div className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 px-3 py-2 text-xs">
          <div className="text-cyan-200/80">自分のベスト</div>
          <div className="flex items-baseline justify-between">
            <span className="neon-num text-lg text-cyan-200">{profile.best.score.toLocaleString()}</span>
            <span className="text-white/60">全期間 {profile.best.rank} 位 ・ {profile.totalGames} プレイ</span>
          </div>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!error && data && data.entries.length === 0 && (
          <p className="py-6 text-center text-sm text-white/50">まだ記録がありません。最初の1位を狙おう！</p>
        )}
        {data && data.entries.length > 0 && (
          <ol className="space-y-1">
            {data.entries.map((e) => {
              const mine = me?.player.id === e.playerId;
              return (
                <li
                  key={e.playerId}
                  className={`grid grid-cols-[2rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    mine ? 'bg-fuchsia-500/20 ring-1 ring-fuchsia-400/60' : 'bg-white/[0.03]'
                  }`}
                >
                  <span className={`neon-num text-center ${e.rank <= 3 ? 'text-yellow-300' : 'text-white/50'}`}>{e.rank}</span>
                  <span className="truncate">
                    {e.nickname}
                    <span className="ml-2 text-[10px] text-white/40">Lv{e.level} / {e.lines}L</span>
                  </span>
                  <span className="neon-num text-cyan-200">{e.score.toLocaleString()}</span>
                </li>
              );
            })}
          </ol>
        )}
        {loading && !data && <p className="py-6 text-center text-sm text-white/50">読み込み中…</p>}
      </div>
      {data?.since != null && (
        <p className="mt-2 text-[10px] text-white/40">集計開始：{new Date(data.since).toLocaleString()}（UTC 基準）</p>
      )}
    </section>
  );
}
