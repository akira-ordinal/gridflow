/**
 * POST /api/auth/logout
 */
import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, clearedCookieOptions } from '@/lib/auth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', clearedCookieOptions());
  return response;
}
