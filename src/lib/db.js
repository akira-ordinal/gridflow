/**
 * PostgreSQL 接続プール
 * 配置先: src/lib/db.js
 *
 * それまでの実装は API ルート毎に `new Client()` → `connect()` → `end()` を
 * 行っていたため、同時アクセスが増えると接続のオープン/クローズが詰まり、
 * DBの max_connections にすぐ到達してしまう。
 * 本ファイルでは pg.Pool をモジュールスコープでシングルトン化し、
 * 全APIルートで使い回す。
 *
 * 使い方:
 *   import { query } from '@/lib/db';
 *   const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
 */

import { Pool } from 'pg';

// Next.js の開発サーバーは hot-reload のたびにモジュールを再評価するため、
// globalThis にプールを保持して二重生成を防ぐ（本番の1プロセス内では通常1個のみ生成される）
const globalForPg = globalThis;

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL が設定されていません。.env.local を確認してください（.env.example を参照）'
    );
  }

  return new Pool({
    connectionString,
    // Neon / Supabase / Vercel Postgres などマネージドDBは基本SSL必須。
    // ローカルDB接続時は `sslmode=disable` などをDATABASE_URLに含めればここは無視される。
    ssl: connectionString.includes('sslmode=disable')
      ? false
      : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getPool() {
  if (!globalForPg._gridflowPgPool) {
    globalForPg._gridflowPgPool = createPool();
  }
  return globalForPg._gridflowPgPool;
}

/**
 * クエリを実行する
 * @param {string} text - SQL（プレースホルダは $1, $2, ...）
 * @param {Array} params
 */
export async function query(text, params = []) {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * トランザクションが必要な処理向けにクライアントを1本借りる
 * 呼び出し側で必ず client.release() すること
 *
 * 使い方:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
export async function getClient() {
  const pool = getPool();
  return pool.connect();
}
