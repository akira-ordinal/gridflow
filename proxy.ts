/**
 * Next.js Proxy（旧 Middleware）— ルート保護
 * 配置先: proxy.ts（プロジェクトルート）
 *
 * Next.js 16 で `middleware.ts` は非推奨となり `proxy.ts` に名称変更された
 * （挙動は同じ、ファイル名と関数名のみの変更）。
 *
 * これまでは /dashboard にも /api/bot/* にも認証チェックが一切なく、
 * トークンを持たない第三者がそのままアクセスできる状態だった。
 * ここで一括して「未ログインなら弾く」を保証する。
 *
 * 補足: Proxy は常に Node.js ランタイムで動作する（Edge非対応）。
 * src/lib/auth.js は元々 Edge でも動く jose ベースで実装してあるため、
 * そのままこのファイルでも同じ検証ロジックを import できる。
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';

// ログインしていないと使えないページ（未ログイン時は /login にリダイレクト）
const PROTECTED_PAGE_PREFIXES = ['/dashboard'];

// ログインしていないと使えないAPI（未ログイン時は401 JSON）
const PROTECTED_API_PREFIXES = ['/api/bot', '/api/credentials'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (session) {
    return NextResponse.next();
  }

  if (isProtectedApi) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // ページの場合はログイン画面へ。ログイン後に元のページへ戻れるよう ?next= を付与
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/bot/:path*', '/api/credentials/:path*'],
};
