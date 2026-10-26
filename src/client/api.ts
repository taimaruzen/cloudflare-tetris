import type {
  ApiErrorBody,
  CreatePlayerResponse,
  HealthResponse,
  PlayerProfileResponse,
  PlayerPublic,
  RankingPeriod,
  RankingResponse,
  StartGameResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '../shared/api-types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'network_error', 'サーバーに接続できませんでした');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* JSON 以外 */
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `エラーが発生しました（${res.status}）`);
  }
  return data as T;
}

const RANKING_PATHS: Record<RankingPeriod, string> = {
  all: '/api/rankings',
  weekly: '/api/rankings/weekly',
  daily: '/api/rankings/daily',
};

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  rankings: (period: RankingPeriod, limit = 50) => request<RankingResponse>(`${RANKING_PATHS[period]}?limit=${limit}`),
  player: (id: string) => request<PlayerProfileResponse>(`/api/players/${encodeURIComponent(id)}`),
  createPlayer: (nickname: string, turnstileToken?: string) =>
    request<CreatePlayerResponse>('/api/players', {
      method: 'POST',
      body: JSON.stringify({ nickname, turnstileToken }),
    }),
  startGame: (token: string) => request<StartGameResponse>('/api/games', { method: 'POST', token, body: '{}' }),
  submitScore: (token: string, body: SubmitScoreRequest) =>
    request<SubmitScoreResponse>('/api/scores', { method: 'POST', token, body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------- 端末に保存するプレイヤー情報

export interface StoredPlayer {
  player: PlayerPublic;
  token: string;
}

const PLAYER_KEY = 'neon-drop:player';
const SETTINGS_KEY = 'neon-drop:settings';

export function loadPlayer(): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPlayer;
    return v?.player?.id && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function savePlayer(p: StoredPlayer | null): void {
  try {
    if (p) localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
    else localStorage.removeItem(PLAYER_KEY);
  } catch {
    /* プライベートモードなど */
  }
}

export interface Settings {
  muted: boolean;
  ghost: boolean;
}

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { muted: v.muted ?? false, ghost: v.ghost ?? true };
  } catch {
    return { muted: false, ghost: true };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 無視 */
  }
}
