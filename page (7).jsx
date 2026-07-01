/**
 * POST /api/auth/register
 * 新規ユーザー登録
 */
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  hashPassword,
  createSessionToken,
  sessionCookieOptions,
  isValidEmail,
  isPasswordStrongEnough,
  normalizeEmail,
  AUTH_COOKIE_NAME,
} from '@/lib/auth';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 });
    }

    const email = normalizeEmail(body.email || '');
    const { password } = body;

    // ── バリデーション ────────────────────────────
    if (!email || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは必須です' },
        { status: 400 }
      );
    }
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: 'メールアドレスの形式が正しくありません' },
        { status: 400 }
      );
    }
    if (!isPasswordStrongEnough(password)) {
      return NextResponse.json(
        { error: 'パスワードは8文字以上で設定してください' },
        { status: 400 }
      );
    }

    // ── 重複チェック ──────────────────────────────
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      // メール存在有無を明かしすぎない意味でも、フロント表示は login と揃えている
      return NextResponse.json(
        { error: 'このメールアドレスは既に登録されています' },
        { status: 409 }
      );
    }

    // ── ユーザー作成 ──────────────────────────────
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, display_name, created_at`,
      [email, passwordHash]
    );
    const user = result.rows[0];

    // ── セッション発行 ────────────────────────────
    const token = await createSessionToken({ userId: user.id, email: user.email });

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
    response.cookies.set(AUTH_COOKIE_NAME, token, sessionCookieOptions());
    return response;

  } catch (error) {
    console.error('[POST /api/auth/register]', error);
    // users.email の UNIQUE制約に競合した場合（同時リクエストなど）
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'このメールアドレスは既に登録されています' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: '登録に失敗しました' }, { status: 500 });
  }
}
