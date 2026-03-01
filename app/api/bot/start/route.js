/**
 * ボット制御 API Route
 * 配置先: src/app/api/bot/start/route.js
 *
 * POST /api/bot/start  → ボット起動
 * POST /api/bot/stop   → ボット停止（src/app/api/bot/stop/route.js に複製）
 */

import { NextResponse } from 'next/server';
// import { GridBot, GridCalculator } from '@/lib/gridBot';
// import { BitTradeClient, decryptApiKey } from '@/lib/bittrade';
// import { db } from '@/lib/db';  // prisma or pg client

/** POST /api/bot/start */
export async function POST(request) {
  try {
    const body = await request.json();
    const { symbol, upperPrice, lowerPrice, gridCount, budget, dryRun } = body;

    // ── バリデーション ──────────────────────────────
    if (!symbol)                     return NextResponse.json({ error: 'symbol は必須です' }, { status: 400 });
    if (upperPrice <= lowerPrice)    return NextResponse.json({ error: 'upperPrice > lowerPrice が必要です' }, { status: 400 });
    if (gridCount < 2 || gridCount > 100) return NextResponse.json({ error: 'gridCount は 2〜100 の範囲です' }, { status: 400 });
    if (budget <= 0)                 return NextResponse.json({ error: 'budget は正の値が必要です' }, { status: 400 });

    // ── 認証確認（TODO: セッション/JWTの検証） ──────
    // const session = await getServerSession();
    // if (!session) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    // ── APIキー取得・復号（TODO: DBから取得） ────────
    // const credential = await db.apiCredentials.findFirst({ where: { userId: session.user.id } });
    // const apiKey    = decryptApiKey(credential.encryptedKey,    process.env.ENCRYPTION_KEY);
    // const apiSecret = decryptApiKey(credential.encryptedSecret, process.env.ENCRYPTION_KEY);

    // ── ボット設定をDBに保存（TODO） ─────────────────
    // const bot = await db.bots.create({ data: { userId: session.user.id, symbol, upperPrice, ... } });

    // ── ボット起動（TODO: サーバーサイドで管理） ─────
    // const gridBot = new GridBot({ symbol, upperPrice, lowerPrice, gridCount, totalBudget: budget, apiKey, apiSecret, dryRun });
    // await gridBot.start();

    // 現段階: ペーパートレード確認のみ返す
    const estimate = calcEstimate(upperPrice, lowerPrice, gridCount, budget);

    return NextResponse.json({
      success    : true,
      message    : dryRun ? 'DryRunモードで起動しました' : 'ボットを起動しました',
      botId      : 'demo-bot-id',
      dryRun,
      estimate,
    });

  } catch (error) {
    console.error('[POST /api/bot/start]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function calcEstimate(upper, lower, count, budget) {
  const step        = (upper - lower) / (count - 1);
  const avg         = (upper + lower) / 2;
  const qty         = (budget / count) / avg;
  const profitPer   = step * qty;
  const dailyTrades = Math.round(count * 0.3);
  return {
    stepSize    : Math.round(step),
    profitPer   : profitPer.toFixed(4),
    dailyTrades,
    dailyProfit : Math.round(profitPer * dailyTrades),
  };
}
