import { cleanupSessions, handleApi } from './api';
import type { Env } from './env';
import { HttpError, errorResponse } from './http';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        if (err instanceof HttpError) return errorResponse(err);
        console.error('unhandled error', err);
        return errorResponse(new HttpError(500, 'internal_error', 'サーバーでエラーが発生しました'));
      }
    }
    // API 以外は静的アセット（SPA）へ
    void ctx;
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      cleanupSessions(env).then((n) => console.log(`cleaned up ${n} expired sessions`)),
    );
  },
} satisfies ExportedHandler<Env>;
