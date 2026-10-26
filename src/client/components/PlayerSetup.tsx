import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, savePlayer, type StoredPlayer } from '../api';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; theme?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

interface Props {
  turnstileSiteKey: string | null;
  onRegistered: (p: StoredPlayer) => void;
  onCancel?: () => void;
}

/** Turnstile のスクリプトは、サイトキーが設定されているときだけ読み込む */
function useTurnstile(siteKey: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const el = ref.current;
    const render = () => window.turnstile?.render(el, { sitekey: siteKey, callback: setToken, theme: 'dark' });
    if (window.turnstile) {
      render();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [siteKey]);
  return { ref, token };
}

/** ニックネームを登録してランキングに参加する */
export function PlayerSetup({ turnstileSiteKey, onRegistered, onCancel }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ts = useTurnstile(turnstileSiteKey);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPlayer(name, ts.token ?? undefined);
      const stored = { player: res.player, token: res.token };
      savePlayer(stored);
      onRegistered(stored);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full space-y-3">
      <label className="block text-left text-xs tracking-wider text-cyan-200/80" htmlFor="nickname">
        ニックネーム（ランキングに表示されます）
      </label>
      <input
        id="nickname"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={16}
        autoComplete="nickname"
        placeholder="例：NEON_ACE"
        className="w-full rounded-lg border border-cyan-400/40 bg-black/40 px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-cyan-300 focus:shadow-[0_0_14px_rgba(34,211,238,0.5)]"
      />
      {turnstileSiteKey && <div ref={ts.ref} className="flex justify-center" />}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" className="btn-ghost flex-1" onClick={onCancel}>
            キャンセル
          </button>
        )}
        <button type="submit" className="btn-neon flex-1" disabled={busy || name.trim().length === 0 || (!!turnstileSiteKey && !ts.token)}>
          {busy ? '登録中…' : '登録する'}
        </button>
      </div>
    </form>
  );
}
