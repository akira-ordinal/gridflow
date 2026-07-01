/**
 * /api/credentials — 取引所APIキーの登録・一覧
 * 配置先: app/api/credentials/route.js
 *
 * db/schema.sql には api_credentials テーブルが定義されていたが、
 * それを実際に読み書きするAPIルートがこれまで存在しなかった
 * （＝ボットを本番運用するための鍵をユーザーが保存する手段がなかった）。
 *
 * 認証チェックは middleware.ts で /api/credentials/* に対して既に行われているが、
 * 万一 middleware の matcher 設定が変わってもこのルート単体で安全なように、
 * ここでも getSessionUser で二重にチェックする（defense in depth）。
 */
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { BitTradeClient, encryptApiKey } from '@/lib/bittrade';

const SUPPORTED_EXCHANGES = ['bittrade'];

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY が未設定、または不正な形式です（32バイト=64文字のhex文字列が必要）。.env.example を参照してください'
    );
  }
  return key;
}

/** GET /api/credentials — 保存済みの取引所連携状況を返す（秘密鍵は絶対に返さない） */
export async function GET(request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const result = await query(
    `SELECT exchange, is_verified, last_verified_at, created_at
     FROM api_credentials
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [session.userId]
  );

  return NextResponse.json({ credentials: result.rows });
}

/** POST /api/credentials — APIキーを暗号化して保存（+ 可能なら即時検証） */
export async function POST(request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 });
  }

  const exchange = body.exchange || 'bittrade';
  const { apiKey, apiSecret } = body;

  if (!SUPPORTED_EXCHANGES.includes(exchange)) {
    return NextResponse.json({ error: `未対応の取引所です: ${exchange}` }, { status: 400 });
  }
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'APIキーとAPIシークレットは必須です' }, { status: 400 });
  }

  let encryptionKey;
  try {
    encryptionKey = getEncryptionKey();
  } catch (err) {
    console.error('[POST /api/credentials]', err);
    return NextResponse.json({ error: 'サーバー側の暗号化設定が不足しています' }, { status: 500 });
  }

  // ── 保存前に実際に疎通確認する（残高取得APIを叩けるか） ──
  // 失敗しても保存自体は許可し、is_verified=false として記録する。
  // （取引所側が一時的に落ちているだけの可能性があるため、保存をブロックしない）
  let isVerified = false;
  try {
    const client = new BitTradeClient({ apiKey, apiSecret, dryRun: false });
    await client.getBalances();
    isVerified = true;
  } catch (err) {
    console.warn('[POST /api/credentials] 疎通確認に失敗（保存は継続）:', err?.message);
  }

  const encryptedKey = Buffer.from(encryptApiKey(apiKey, encryptionKey), 'utf8');
  const encryptedSecret = Buffer.from(encryptApiKey(apiSecret, encryptionKey), 'utf8');

  await query(
    `INSERT INTO api_credentials (user_id, exchange, api_key_enc, api_secret_enc, is_verified, last_verified_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END)
     ON CONFLICT (user_id, exchange)
     DO UPDATE SET
       api_key_enc = EXCLUDED.api_key_enc,
       api_secret_enc = EXCLUDED.api_secret_enc,
       is_verified = EXCLUDED.is_verified,
       last_verified_at = EXCLUDED.last_verified_at`,
    [session.userId, exchange, encryptedKey, encryptedSecret, isVerified]
  );

  return NextResponse.json({
    success: true,
    exchange,
    isVerified,
    message: isVerified
      ? 'APIキーを保存し、疎通確認に成功しました'
      : 'APIキーを保存しました（疎通確認は失敗したため、キーの権限・IP制限をご確認ください）',
  });
}

/** DELETE /api/credentials?exchange=bittrade — 登録済みキーの削除 */
export async function DELETE(request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const exchange = request.nextUrl.searchParams.get('exchange') || 'bittrade';
  await query('DELETE FROM api_credentials WHERE user_id = $1 AND exchange = $2', [
    session.userId,
    exchange,
  ]);

  return NextResponse.json({ success: true });
}
