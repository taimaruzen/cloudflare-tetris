import type { ApiErrorBody } from '../shared/api-types';

/** API で返すエラー。status と code はクライアントにそのまま返す */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

export function json(data: unknown, init: ResponseInit & { cacheSeconds?: number } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', init.cacheSeconds ? `public, max-age=${init.cacheSeconds}` : 'no-store');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function errorResponse(err: HttpError): Response {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
  return json(body, { status: err.status, headers: err.headers });
}

/** 本文サイズを制限しつつ JSON を読む */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type は application/json にしてください');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large', 'リクエストが大きすぎます');

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_body', 'リクエスト本文がありません');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large', 'リクエストが大きすぎます');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON の形式が正しくありません');
  }
}

/**
 * ブラウザ以外の別オリジンからの書き込みを拒否する（CSRF 対策）。
 * Origin ヘッダーがある場合は、自分自身のオリジンと一致することを要求する。
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  const self = new URL(request.url).origin;
  if (origin !== self) throw new HttpError(403, 'forbidden_origin', '許可されていないオリジンです');
}
