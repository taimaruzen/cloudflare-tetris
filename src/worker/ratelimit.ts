import { HttpError } from './http';

/**
 * Workers Rate Limiting バインディングで制限する。
 * バインディングが無い環境（テストなど）ではアイソレート内のメモリで簡易的に制限する。
 */
const memory = new Map<string, { count: number; resetAt: number }>();
const FALLBACK_LIMITS: Record<string, number> = { read: 120, write: 30, signup: 5 };

export async function enforceRateLimit(
  binding: RateLimit | undefined,
  bucket: 'read' | 'write' | 'signup',
  key: string,
): Promise<void> {
  const fullKey = `${bucket}:${key}`;
  let ok: boolean;
  if (binding) {
    ok = (await binding.limit({ key: fullKey })).success;
  } else {
    const now = Date.now();
    const entry = memory.get(fullKey);
    if (!entry || entry.resetAt <= now) {
      memory.set(fullKey, { count: 1, resetAt: now + 60_000 });
      ok = true;
    } else {
      entry.count++;
      ok = entry.count <= FALLBACK_LIMITS[bucket]!;
    }
    if (memory.size > 10_000) memory.clear();
  }
  if (!ok) {
    throw new HttpError(429, 'rate_limited', 'リクエストが多すぎます。しばらく待ってから再試行してください', {
      'Retry-After': '60',
    });
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
