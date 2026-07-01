/**
 * POST /api/auth/login
 * ログイン
 */
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  verifyPassword,
  createSessionToken,
  sessionCookieOptions,
  normalizeEmail,
  AUTH_COOKIE_NAME,
} from '@/lib/auth';

// メール存在有無を推測されないよう、失敗理由に関わらず同じメッセージ・同じ401を返す
const INVALID_CREDENTIALS_MESSAGE = 'メールアドレスまたはパスワードが間違っています';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 });
    }

    const email = normalizeEmail(body.email || '');
    const { password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは必須です' },
        { status: 400 }
      );
    }

    const result = await query(
      'SELECT id, email, password_hash, display_name, is_active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return NextResponse.json(
        { error: 'このアカウントは無効化されています。サポートにお問い合わせください' },
        { status: 403 }
      );
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    const token = await createSessionToken({ userId: user.id, email: user.email });

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
    response.cookies.set(AUTH_COOKIE_NAME, token, sessionCookieOptions());
    return response;

  } catch (error) {
    console.error('[POST /api/auth/login]', error);
    return NextResponse.json({ error: 'ログインに失敗しました' }, { status: 500 });
  }
}
