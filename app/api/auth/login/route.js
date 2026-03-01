import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Client } = pg;

export async function POST(request) {
  try {
    const { email, password } = await request.json();

    // バリデーション
    if (!email || !password) {
      return NextResponse.json(
        { error: 'メールアドレスとパスワードは必須です' },
        { status: 400 }
      );
    }

    // DB接続
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();

    // ユーザー検索
    const result = await client.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );

    await client.end();

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'メールアドレスまたはパスワードが間違っています' },
        { status: 401 }
      );
    }

    const user = result.rows[0];

    // パスワード検証
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return NextResponse.json(
        { error: 'メールアドレスまたはパスワードが間違っています' },
        { status: 401 }
      );
    }

    // JWTトークン生成
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.NEXTAUTH_SECRET,
      { expiresIn: '7d' }
    );

    // レスポンス作成
    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email },
    });

    // Cookieにトークンをセット
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7日間
    });

    return response;
  } catch (error) {
    console.error('ログインエラー:', error);
    return NextResponse.json(
      { error: 'ログインに失敗しました' },
      { status: 500 }
    );
  }
}