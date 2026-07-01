/**
 * 認証まわりの共通ロジック
 * 配置先: src/lib/auth.js
 *
 * これまで login/register 各ルートに jsonwebtoken でのトークン生成コードが
 * 重複しており、かつ発行したトークンを検証する処理がアプリのどこにも
 * 存在しなかった（= /dashboard も /api/bot/* も未ログインで叩けてしまう状態）。
 *
 * jsonwebtoken は Node.js の crypto モジュールに依存するため、
 * Next.js の Middleware（Edge Runtime）内では動作しない。
 * そのため Web Crypto ベースで動く `jose` に統一し、
 * このファイル1つを API Route からも Middleware からも import できるようにする。
 */

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

export const AUTH_COOKIE_NAME = 'auth-token';
const SESSION_DURATION = '7d';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7日間

function getJwtSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET が未設定、または短すぎます。.env.local で32文字以上のランダム文字列を設定してください'
    );
  }
  return new TextEncoder().encode(secret);
}

// ── パスワード ────────────────────────────────────────

/** パスワードをハッシュ化する（登録時） */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 12);
}

/** パスワードを検証する（ログイン時） */
export async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * MVPとしての最低限のパスワード強度チェック
 * （8文字以上。それ以上の複雑性要件は今回は課さない — 必要になれば拡張）
 */
export function isPasswordStrongEnough(plainPassword) {
  return typeof plainPassword === 'string' && plainPassword.length >= 8;
}

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

// ── JWT セッショントークン ──────────────────────────────

/**
 * セッショントークンを発行する
 * @param {{ userId: string, email: string }} payload
 */
export async function createSessionToken(payload) {
  const secretKey = getJwtSecretKey();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretKey);
}

/**
 * セッショントークンを検証する
 * @returns {Promise<{ userId: string, email: string } | null>} 無効な場合は null
 */
export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const secretKey = getJwtSecretKey();
    const { payload } = await jwtVerify(token, secretKey);
    return payload;
  } catch {
    // 期限切れ・改ざん・シークレット不一致など、理由を問わず無効として扱う
    return null;
  }
}

/** Cookie にセッショントークンをセットする際の共通オプション */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** ログアウト時にCookieを即時失効させるためのオプション */
export function clearedCookieOptions() {
  return {
    ...sessionCookieOptions(),
    maxAge: 0,
  };
}

/**
 * Next.js の Route Handler (`app/api/**\/route.js`) 内で、
 * リクエストの Cookie からログイン中ユーザーを取得する。
 *
 * 使い方:
 *   const user = await getSessionUser(request);
 *   if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
 */
export async function getSessionUser(request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}
