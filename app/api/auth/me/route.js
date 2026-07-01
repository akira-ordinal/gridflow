/**
 * GET /api/auth/me
 * ログイン中ユーザーの情報を返す。ダッシュボードの認証ガード・表示名取得に使用。
 */
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function GET(request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // トークンは有効でも、その後アカウントが無効化/削除されていないかは都度DBで確認する
  const result = await query(
    'SELECT id, email, display_name, is_active FROM users WHERE id = $1',
    [session.userId]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  return NextResponse.json({
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
}
