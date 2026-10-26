import { HttpError } from './http';

export const NICKNAME_MAX = 16;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 文字・数字・結合文字・一部の記号のみ許可（制御文字や書式文字は拒否） */
const NICKNAME_RE = /^[\p{L}\p{N}\p{M} _\-.・ー～!?☆★♪]+$/u;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function requireObject(v: unknown): Record<string, unknown> {
  if (!isObject(v)) throw new HttpError(400, 'invalid_body', 'リクエスト本文はオブジェクトにしてください');
  return v;
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function requireUuid(v: unknown, field: string): string {
  if (!isUuid(v)) throw new HttpError(400, 'invalid_' + field, `${field} の形式が正しくありません`);
  return v;
}

/** ニックネームを正規化して検証する */
export function normalizeNickname(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_nickname', 'ニックネームを入力してください');
  const name = v.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const length = [...name].length;
  if (length < 1) throw new HttpError(400, 'invalid_nickname', 'ニックネームを入力してください');
  if (length > NICKNAME_MAX) {
    throw new HttpError(400, 'invalid_nickname', `ニックネームは${NICKNAME_MAX}文字以内にしてください`);
  }
  if (!NICKNAME_RE.test(name)) {
    throw new HttpError(400, 'invalid_nickname', 'ニックネームに使えない文字が含まれています');
  }
  return name;
}

export function requireInt(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new HttpError(400, 'invalid_' + field, `${field} が範囲外です`);
  }
  return v;
}

export function parseLimit(url: URL, def = 50, max = 100): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new HttpError(400, 'invalid_limit', `limit は 1〜${max} の整数にしてください`);
  }
  return n;
}
