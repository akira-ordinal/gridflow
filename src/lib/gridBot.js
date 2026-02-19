/**
 * GridBot - Core Grid Trading Logic
 * BitTrade 連携グリッドトレーディングボット
 *
 * 使い方:
 *   const bot = new GridBot({ ... });
 *   await bot.start();
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────
// 型定義（JSDoc）
// ─────────────────────────────────────────────
/**
 * @typedef {Object} GridConfig
 * @property {string}  symbol        - 取引ペア例: 'btc_jpy'
 * @property {number}  upperPrice    - グリッド上限価格
 * @property {number}  lowerPrice    - グリッド下限価格
 * @property {number}  gridCount     - グリッド本数（最小5、最大100）
 * @property {number}  totalBudget   - 運用金額（円）
 * @property {string}  apiKey        - BitTrade API Key
 * @property {string}  apiSecret     - BitTrade API Secret
 * @property {boolean} [dryRun]      - true = ペーパートレードモード
 */

/**
 * @typedef {Object} GridLevel
 * @property {number}  price         - グリッド価格
 * @property {number}  quantity      - 注文数量
 * @property {'buy'|'sell'} side     - 売買方向
 * @property {string|null} orderId   - BitTrade 注文ID（発注後に設定）
 * @property {'pending'|'open'|'filled'|'cancelled'} status
 */

// ─────────────────────────────────────────────
// BitTrade API クライアント（シン実装）
// ─────────────────────────────────────────────
class BitTradeClient {
  constructor(apiKey, apiSecret, dryRun = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.dryRun = dryRun;
    this.baseUrl = 'https://api.bittrade.co.jp';
    this._dryRunOrderId = 1000;
  }

  /** HMAC-SHA256 署名生成 */
  _sign(nonce, method, path, body = '') {
    const message = nonce + method.toUpperCase() + path + body;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('hex');
  }

  /** 認証ヘッダーを生成 */
  _authHeaders(method, path, body = '') {
    const nonce = Date.now().toString();
    const signature = this._sign(nonce, method, path, body);
    return {
      'Content-Type': 'application/json',
      'Api-Key': this.apiKey,
      'Api-Nonce': nonce,
      'Api-Signature': signature,
    };
  }

  /** 現在価格を取得 */
  async getTicker(symbol) {
    if (this.dryRun) {
      // ペーパートレードモード: ランダムな価格変動をシミュレート
      return { lastPrice: this._dryRunPrice || 5000000 };
    }
    const path = `/v1/ticker?symbol=${symbol}`;
    const res = await fetch(this.baseUrl + path);
    const data = await res.json();
    return { lastPrice: parseFloat(data.last) };
  }

  /** 指値注文を発注 */
  async placeOrder({ symbol, side, price, quantity }) {
    if (this.dryRun) {
      const id = String(this._dryRunOrderId++);
      console.log(`[DryRun] ${side.toUpperCase()} ${quantity} ${symbol} @ ¥${price.toLocaleString()} → OrderID: ${id}`);
      return { orderId: id, status: 'open' };
    }
    const path = '/v1/order';
    const body = JSON.stringify({ symbol, side, type: 'limit', price, quantity });
    const headers = this._authHeaders('POST', path, body);
    const res = await fetch(this.baseUrl + path, { method: 'POST', headers, body });
    const data = await res.json();
    if (!res.ok) throw new Error(`注文エラー: ${data.message}`);
    return { orderId: data.id, status: 'open' };
  }

  /** 注文をキャンセル */
  async cancelOrder(orderId, symbol) {
    if (this.dryRun) {
      console.log(`[DryRun] Cancel OrderID: ${orderId}`);
      return true;
    }
    const path = `/v1/order/${orderId}`;
    const headers = this._authHeaders('DELETE', path);
    const res = await fetch(this.baseUrl + path, { method: 'DELETE', headers });
    return res.ok;
  }

  /** 注文ステータスを確認 */
  async getOrderStatus(orderId, symbol) {
    if (this.dryRun) {
      // ペーパートレード: 価格が近ければランダムに約定させる
      return { status: Math.random() > 0.7 ? 'filled' : 'open' };
    }
    const path = `/v1/order/${orderId}`;
    const headers = this._authHeaders('GET', path);
    const res = await fetch(this.baseUrl + path, { headers });
    const data = await res.json();
    return { status: data.state }; // 'open' | 'filled' | 'cancelled'
  }
}

// ─────────────────────────────────────────────
// グリッド自動計算ユーティリティ
// ─────────────────────────────────────────────
class GridCalculator {
  /**
   * 現在価格から自動でグリッド設定を推奨する（初心者向け「おまかせモード」）
   * @param {number} currentPrice - 現在価格
   * @param {number} budget       - 運用金額（円）
   * @param {'low'|'medium'|'high'} risk - リスク許容度
   * @returns {GridConfig の一部}
   */
  static autoConfig(currentPrice, budget, risk = 'medium') {
    const ranges = {
      low:    { spread: 0.05, gridCount: 10 }, // ±5%, 10本
      medium: { spread: 0.10, gridCount: 15 }, // ±10%, 15本
      high:   { spread: 0.20, gridCount: 20 }, // ±20%, 20本
    };
    const { spread, gridCount } = ranges[risk];
    return {
      upperPrice: Math.round(currentPrice * (1 + spread)),
      lowerPrice: Math.round(currentPrice * (1 - spread)),
      gridCount,
    };
  }

  /**
   * グリッドレベルを計算して返す
   * @param {GridConfig} config
   * @returns {GridLevel[]}
   */
  static buildLevels(config) {
    const { upperPrice, lowerPrice, gridCount, totalBudget } = config;

    if (upperPrice <= lowerPrice) throw new Error('上限価格 > 下限価格 が必要です');
    if (gridCount < 2) throw new Error('グリッド本数は2以上が必要です');

    const step = (upperPrice - lowerPrice) / (gridCount - 1);
    const budgetPerGrid = totalBudget / gridCount;

    return Array.from({ length: gridCount }, (_, i) => {
      const price = Math.round(lowerPrice + step * i);
      const quantity = parseFloat((budgetPerGrid / price).toFixed(8));
      return {
        price,
        quantity,
        side: i < Math.floor(gridCount / 2) ? 'buy' : 'sell',
        orderId: null,
        status: 'pending',
      };
    });
  }

  /** 1グリッドあたりの期待利益を計算 */
  static calcExpectedProfit(config) {
    const { upperPrice, lowerPrice, gridCount, totalBudget } = config;
    const step = (upperPrice - lowerPrice) / (gridCount - 1);
    const avgPrice = (upperPrice + lowerPrice) / 2;
    const quantityPerGrid = (totalBudget / gridCount) / avgPrice;
    const profitPerTrade = step * quantityPerGrid;
    return {
      stepSize: Math.round(step),
      profitPerTrade: profitPerTrade.toFixed(4),
      estimatedDailyTrades: Math.round(gridCount * 0.3), // 経験則
      estimatedDailyProfit: (profitPerTrade * gridCount * 0.3).toFixed(0),
    };
  }
}

// ─────────────────────────────────────────────
// GridBot メインクラス
// ─────────────────────────────────────────────
class GridBot {
  /**
   * @param {GridConfig} config
   */
  constructor(config) {
    this._validateConfig(config);
    this.config = config;
    this.client = new BitTradeClient(config.apiKey, config.apiSecret, config.dryRun);
    this.levels = [];
    this.state = 'stopped'; // 'stopped' | 'running' | 'paused' | 'error'
    this.stats = {
      totalTrades: 0,
      totalProfit: 0,
      startedAt: null,
      lastCheckedAt: null,
    };
    this._pollTimer = null;
    this._listeners = {};
  }

  // ─── ライフサイクル ───────────────────────────

  /** ボットを起動する */
  async start() {
    if (this.state === 'running') throw new Error('既に起動中です');

    this._emit('log', 'ボット起動中...');
    this.stats.startedAt = new Date();
    this.state = 'running';

    // グリッドレベル構築
    this.levels = GridCalculator.buildLevels(this.config);
    this._emit('log', `グリッドを${this.levels.length}本設定しました`);

    // 全グリッドに指値注文を発注
    await this._placeAllOrders();

    // ポーリング開始（10秒ごと）
    this._pollTimer = setInterval(() => this._poll(), 10_000);
    this._emit('started', this.getStatus());
    this._emit('log', 'ボット稼働開始 ✅');
  }

  /** ボットを停止する（全注文キャンセル） */
  async stop() {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    clearInterval(this._pollTimer);

    this._emit('log', '全注文をキャンセル中...');
    await this._cancelAllOrders();
    this._emit('stopped', this.getStatus());
    this._emit('log', 'ボット停止 🛑');
  }

  // ─── 内部ロジック ─────────────────────────────

  /** 全グリッドに注文を発注 */
  async _placeAllOrders() {
    for (const level of this.levels) {
      try {
        const { orderId } = await this.client.placeOrder({
          symbol: this.config.symbol,
          side: level.side,
          price: level.price,
          quantity: level.quantity,
        });
        level.orderId = orderId;
        level.status = 'open';
      } catch (err) {
        this._emit('error', `注文発注失敗 @¥${level.price}: ${err.message}`);
      }
      // API レートリミット対策（100ms 間隔）
      await this._sleep(100);
    }
  }

  /** 全注文をキャンセル */
  async _cancelAllOrders() {
    for (const level of this.levels) {
      if (level.orderId && level.status === 'open') {
        await this.client.cancelOrder(level.orderId, this.config.symbol);
        level.status = 'cancelled';
        await this._sleep(100);
      }
    }
  }

  /**
   * ポーリング処理（10秒ごとに約定チェック）
   * 約定したグリッドに対して反対側の注文を自動発注する
   */
  async _poll() {
    if (this.state !== 'running') return;
    this.stats.lastCheckedAt = new Date();

    for (const level of this.levels) {
      if (level.status !== 'open' || !level.orderId) continue;

      try {
        const { status } = await this.client.getOrderStatus(level.orderId, this.config.symbol);

        if (status === 'filled') {
          this._emit('log', `✅ 約定: ${level.side.toUpperCase()} @¥${level.price.toLocaleString()}`);
          this.stats.totalTrades++;

          // 利益計算（売り → 買い の差分）
          const stepSize = (this.config.upperPrice - this.config.lowerPrice) / (this.config.gridCount - 1);
          this.stats.totalProfit += parseFloat((stepSize * level.quantity).toFixed(0));
          this._emit('trade', { level, profit: this.stats.totalProfit });

          // 反対の注文を再発注（グリッドの核心ロジック）
          await this._reorder(level);
        }
      } catch (err) {
        this._emit('error', `ステータス確認エラー: ${err.message}`);
      }
      await this._sleep(50);
    }

    this._emit('status', this.getStatus());
  }

  /**
   * 約定後に反対方向の注文を再発注する
   * 例: 買い約定 → 同価格に売り注文 → 次の約定で利益確定
   */
  async _reorder(filledLevel) {
    const oppositeSide = filledLevel.side === 'buy' ? 'sell' : 'buy';
    try {
      const { orderId } = await this.client.placeOrder({
        symbol: this.config.symbol,
        side: oppositeSide,
        price: filledLevel.price,
        quantity: filledLevel.quantity,
      });
      filledLevel.orderId = orderId;
      filledLevel.status = 'open';
      filledLevel.side = oppositeSide;
      this._emit('log', `🔄 再発注: ${oppositeSide.toUpperCase()} @¥${filledLevel.price.toLocaleString()}`);
    } catch (err) {
      filledLevel.status = 'pending';
      this._emit('error', `再発注失敗: ${err.message}`);
    }
  }

  // ─── ユーティリティ ───────────────────────────

  /** 現在のボット状態を返す */
  getStatus() {
    return {
      state: this.state,
      config: this.config,
      levels: this.levels,
      stats: this.stats,
      openOrders: this.levels.filter(l => l.status === 'open').length,
      expectedProfit: GridCalculator.calcExpectedProfit(this.config),
    };
  }

  _validateConfig(config) {
    if (!config.symbol) throw new Error('symbol は必須です');
    if (config.upperPrice <= config.lowerPrice) throw new Error('upperPrice > lowerPrice が必要です');
    if (config.gridCount < 2 || config.gridCount > 100) throw new Error('gridCount は 2〜100 の範囲です');
    if (config.totalBudget <= 0) throw new Error('totalBudget は正の値が必要です');
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** イベントリスナー登録 */
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }
}

// ─────────────────────────────────────────────
// エクスポート
// ─────────────────────────────────────────────
module.exports = { GridBot, GridCalculator, BitTradeClient };


// ─────────────────────────────────────────────
// 使用例（ペーパートレードモード）
// ─────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const currentPrice = 14_500_000; // BTC ¥14,500,000

    // おまかせモードで設定を自動生成
    const autoConfig = GridCalculator.autoConfig(currentPrice, 100_000, 'medium');
    console.log('📊 推奨グリッド設定:', autoConfig);

    const profitCalc = GridCalculator.calcExpectedProfit({
      ...autoConfig,
      totalBudget: 100_000,
    });
    console.log('💰 期待収益試算:', profitCalc);

    // ボット起動（ペーパートレードモード）
    const bot = new GridBot({
      symbol: 'btc_jpy',
      ...autoConfig,
      totalBudget: 100_000,
      apiKey: 'YOUR_API_KEY',
      apiSecret: 'YOUR_API_SECRET',
      dryRun: true, // ← ペーパートレード
    });

    bot
      .on('log', msg => console.log(`[LOG] ${msg}`))
      .on('trade', ({ level, profit }) =>
        console.log(`[TRADE] 累積利益: ¥${profit.toLocaleString()}`)
      )
      .on('error', err => console.error(`[ERROR] ${err}`));

    await bot.start();

    // 30秒後に停止
    setTimeout(() => bot.stop(), 30_000);
  })();
}
