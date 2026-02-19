/**
 * BitTrade API クライアント（本番対応版）
 * 配置先: src/lib/bittrade.js
 *
 * 使い方:
 *   const client = new BitTradeClient({ apiKey, apiSecret });
 *   const ticker = await client.getTicker('btc_jpy');
 */

const crypto = require('crypto');

// ──────────────────────────────────────────────────────
// 定数
// ──────────────────────────────────────────────────────
const BASE_URL    = 'https://api-cloud.bittrade.co.jp';
const API_VERSION = '';

/** 対応通貨ペア */
const SYMBOLS = {
  BTC_JPY: 'btc_jpy',
  ETH_JPY: 'eth_jpy',
  XRP_JPY: 'xrp_jpy',
  LTC_JPY: 'ltc_jpy',
};

// ──────────────────────────────────────────────────────
// エラークラス
// ──────────────────────────────────────────────────────
class BitTradeError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name        = 'BitTradeError';
    this.statusCode  = statusCode;
    this.body        = body;
  }
}

class BitTradeRateLimitError extends BitTradeError {
  constructor() {
    super('レートリミット超過。しばらく待ってから再試行してください。', 429, null);
    this.name = 'BitTradeRateLimitError';
  }
}

// ──────────────────────────────────────────────────────
// メインクライアント
// ──────────────────────────────────────────────────────
class BitTradeClient {
  /**
   * @param {{ apiKey: string, apiSecret: string, dryRun?: boolean }} options
   */
  constructor({ apiKey, apiSecret, dryRun = false }) {
    if (!apiKey || !apiSecret) throw new Error('apiKey と apiSecret は必須です');
    this._apiKey    = apiKey;
    this._apiSecret = apiSecret;
    this.dryRun     = dryRun;
    this._requestCount = 0;   // レートリミット管理
    this._lastResetTime = Date.now();
  }

  // ── 認証 ─────────────────────────────────────────────

  /**
   * HMAC-SHA256 署名を生成
   * BitTrade の署名仕様: nonce + METHOD + PATH + BODY
   */
  _generateSignature(nonce, method, path, body = '') {
    const message = nonce + method.toUpperCase() + path + body;
    return crypto
      .createHmac('sha256', this._apiSecret)
      .update(message)
      .digest('hex');
  }

  /** 認証ヘッダーを生成 */
  _buildAuthHeaders(method, path, body = '') {
    const nonce     = Date.now().toString();
    const signature = this._generateSignature(nonce, method, path, body);
    return {
      'Content-Type'  : 'application/json',
      'Api-Key'       : this._apiKey,
      'Api-Nonce'     : nonce,
      'Api-Signature' : signature,
    };
  }

  // ── HTTP ─────────────────────────────────────────────

  /** レートリミットチェック（100リクエスト/分） */
  _checkRateLimit() {
    const now = Date.now();
    if (now - this._lastResetTime > 60_000) {
      this._requestCount = 0;
      this._lastResetTime = now;
    }
    if (this._requestCount >= 90) throw new BitTradeRateLimitError();
    this._requestCount++;
  }

  /** GET リクエスト（認証なし - パブリックAPI）*/
  async _get(path) {
    this._checkRateLimit();
    const url = BASE_URL + API_VERSION + path;
    const res = await fetch(url);
    return this._handleResponse(res);
  }

  /** GET リクエスト（認証あり - プライベートAPI）*/
  async _authGet(path) {
    this._checkRateLimit();
    const url = BASE_URL + API_VERSION + path;
    const headers = this._buildAuthHeaders('GET', API_VERSION + path);
    const res = await fetch(url, { headers });
    return this._handleResponse(res);
  }

  /** POST リクエスト（認証あり）*/
  async _authPost(path, data) {
    this._checkRateLimit();
    const url  = BASE_URL + API_VERSION + path;
    const body = JSON.stringify(data);
    const headers = this._buildAuthHeaders('POST', API_VERSION + path, body);
    const res = await fetch(url, { method: 'POST', headers, body });
    return this._handleResponse(res);
  }

  /** DELETE リクエスト（認証あり）*/
  async _authDelete(path) {
    this._checkRateLimit();
    const url  = BASE_URL + API_VERSION + path;
    const headers = this._buildAuthHeaders('DELETE', API_VERSION + path);
    const res = await fetch(url, { method: 'DELETE', headers });
    return this._handleResponse(res);
  }

  /** レスポンスハンドリング */
  async _handleResponse(res) {
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (res.status === 429) throw new BitTradeRateLimitError();
    if (!res.ok) {
      throw new BitTradeError(
        json?.message || `HTTPエラー: ${res.status}`,
        res.status,
        json
      );
    }
    return json;
  }

  // ── パブリック API ────────────────────────────────────

  /**
   * 現在価格（ティッカー）を取得
   * @returns {{ symbol, lastPrice, bidPrice, askPrice, volume24h, high24h, low24h }}
   */
  async getTicker(symbol = 'btc_jpy') {
    if (this.dryRun) return this._mockTicker(symbol);
    const symbol_formatted = symbol.replace('_', '');
const data = await this._get(`/market/detail/merged?symbol=${symbol_formatted}`);
    return {
      symbol,
      lastPrice : parseFloat(data.tick?.close),
      bidPrice  : parseFloat(data.bid),
      askPrice  : parseFloat(data.ask),
      volume24h : parseFloat(data.vol),
      high24h   : parseFloat(data.high),
      low24h    : parseFloat(data.low),
      timestamp : new Date(data.ts),
    };
  }

  /**
   * 板情報（オーダーブック）を取得
   * @returns {{ bids: [{price, quantity}], asks: [{price, quantity}] }}
   */
  async getOrderBook(symbol = 'btc_jpy', depth = 20) {
    if (this.dryRun) return { bids: [], asks: [] };
    const data = await this._get(`/depth?symbol=${symbol}&depth=${depth}`);
    return {
      bids: data.bids.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
      asks: data.asks.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
    };
  }

  // ── プライベート API ──────────────────────────────────

  /**
   * 残高を取得
   * @returns {{ jpy: number, btc: number, eth: number, xrp: number }}
   */
  async getBalances() {
    if (this.dryRun) return { jpy: 1000000, btc: 0.1, eth: 1.0, xrp: 1000 };
    const data = await this._authGet('/v1/account/accounts');
    const balances = {};
    (data.balances || []).forEach(b => {
      balances[b.currency.toLowerCase()] = parseFloat(b.balance);
    });
    return balances;
  }

  /**
   * 指値注文を発注
   * @param {{ symbol, side, price, quantity }} order
   * @returns {{ orderId, status, price, quantity, side, symbol }}
   */
  async placeOrder({ symbol, side, price, quantity }) {
    if (!['buy', 'sell'].includes(side)) throw new Error(`無効な side: ${side}`);
    if (price <= 0) throw new Error(`無効な price: ${price}`);
    if (quantity <= 0) throw new Error(`無効な quantity: ${quantity}`);

    if (this.dryRun) return this._mockOrder({ symbol, side, price, quantity });

    const data = await this._authPost('/v1/order/orders/place', {
      symbol,
      side,
      type    : 'limit',
      price   : price.toString(),
      quantity: quantity.toString(),
    });

    return {
      orderId  : (data.data || data.id || 'unknown').toString(),
      status   : 'open',
      symbol,
      side,
      price    : parseFloat(data.price),
      quantity : parseFloat(data.quantity),
      createdAt: new Date(data.created_at),
    };
  }

  /**
   * 注文をキャンセル
   * @param {string} orderId
   * @returns {boolean}
   */
  async cancelOrder(orderId) {
    if (this.dryRun) {
      console.log(`[DryRun] cancelOrder: ${orderId}`);
      return true;
    }
    await this._authPost(`/v1/order/orders/${orderId}/submitcancel`, {});
    return true;
  }

  /**
   * 注文ステータスを取得
   * @param {string} orderId
   * @returns {{ orderId, status, filledQty, remainQty }}
   */
  async getOrderStatus(orderId) {
    if (this.dryRun) return this._mockOrderStatus(orderId);

    const data = await this._authGet(`/v1/order/orders/${orderId}`);
    return {
      orderId    : (data.data?.id || data.id || orderId).toString(),
      status     : this._normalizeStatus(data.data?.state || data.state),
      filledQty  : parseFloat(data.filled_qty || 0),
      remainQty  : parseFloat(data.remain_qty || 0),
      price      : parseFloat(data.price),
      updatedAt  : new Date(data.updated_at),
    };
  }

  /**
   * 未約定注文一覧を取得
   * @returns {Array}
   */
  async getOpenOrders(symbol) {
    if (this.dryRun) return [];
    const path = `/orders?symbol=${symbol}&status=open`;
    const data = await this._authGet(path);
    return (data.orders || []).map(o => ({
      orderId  : o.id.toString(),
      status   : this._normalizeStatus(o.state),
      side     : o.side,
      price    : parseFloat(o.price),
      quantity : parseFloat(o.quantity),
    }));
  }

  /** BitTrade のステータスを正規化 */
  _normalizeStatus(state) {
    const map = {
      'open'      : 'open',
      'filled'    : 'filled',
      'cancelled' : 'cancelled',
      'partial'   : 'open',  // 部分約定は open として扱う
    };
    return map[state] || state;
  }

  // ── DryRun モック ────────────────────────────────────

  _mockPrice = 14_500_000;

  _mockTicker(symbol) {
    this._mockPrice = Math.round(this._mockPrice * (1 + (Math.random() - 0.5) * 0.002));
    return {
      symbol,
      lastPrice : this._mockPrice,
      bidPrice  : this._mockPrice - 1000,
      askPrice  : this._mockPrice + 1000,
      volume24h : 120.5,
      high24h   : this._mockPrice * 1.02,
      low24h    : this._mockPrice * 0.98,
      timestamp : new Date(),
    };
  }

  _mockOrderId = 10000;

  _mockOrder({ symbol, side, price, quantity }) {
    const id = String(this._mockOrderId++);
    console.log(`[DryRun] ${side.toUpperCase()} ${quantity} ${symbol} @ ¥${price.toLocaleString()} → #${id}`);
    return { orderId: id, status: 'open', symbol, side, price, quantity, createdAt: new Date() };
  }

  _mockOrderStatus(orderId) {
    const filled = Math.random() > 0.6;
    return {
      orderId,
      status   : filled ? 'filled' : 'open',
      filledQty: filled ? 0.001 : 0,
      remainQty: filled ? 0 : 0.001,
    };
  }
}

// ──────────────────────────────────────────────────────
// APIキー暗号化ユーティリティ
// ──────────────────────────────────────────────────────

/**
 * APIキーを AES-256-GCM で暗号化（DB保存前に使用）
 * @param {string} plainText - 平文のAPIキー
 * @param {string} masterKey - 環境変数 ENCRYPTION_KEY (32バイトのhex文字列)
 * @returns {string} "iv:authTag:encrypted" 形式の文字列
 */
function encryptApiKey(plainText, masterKey) {
  const key = Buffer.from(masterKey, 'hex');
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 暗号化されたAPIキーを復号（DB読み込み後に使用）
 */
function decryptApiKey(encryptedText, masterKey) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const key     = Buffer.from(masterKey, 'hex');
  const iv      = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ──────────────────────────────────────────────────────
// エクスポート
// ──────────────────────────────────────────────────────
module.exports = { BitTradeClient, BitTradeError, BitTradeRateLimitError, encryptApiKey, decryptApiKey, SYMBOLS };


// ──────────────────────────────────────────────────────
// 疎通テスト（$ node src/lib/bittrade.js で実行）
// ──────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    console.log('=== BitTrade API 疎通テスト ===\n');

    // ① ペーパートレードで接続確認
    const client = new BitTradeClient({
      apiKey   : process.env.BITTRADE_API_KEY    || 'test_key',
      apiSecret: process.env.BITTRADE_API_SECRET || 'test_secret',
      dryRun   : !process.env.BITTRADE_API_KEY,   // envがなければDryRun
    });

    console.log(`モード: ${client.dryRun ? '🟡 DryRun (ペーパートレード)' : '🟢 本番'}\n`);

    // ② ティッカー取得
    console.log('【1】ティッカー取得...');
    const ticker = await client.getTicker('btc_jpy');
    console.log(`   BTC/JPY: ¥${ticker.lastPrice.toLocaleString()}\n`);

    // ③ 残高確認
    console.log('【2】残高確認...');
    const balances = await client.getBalances();
    console.log(`   JPY: ¥${balances.jpy?.toLocaleString() || 0}`);
    console.log(`   BTC: ${balances.btc || 0} BTC\n`);

    // ④ テスト注文（DryRunのみ）
    console.log('【3】テスト注文（DryRun）...');
    const order = await client.placeOrder({
      symbol  : 'btc_jpy',
      side    : 'buy',
      price   : 14000000,
      quantity: 0.0001,
    });
    console.log(`   注文ID: ${order.orderId}, ステータス: ${order.status}\n`);

    // ⑤ 注文ステータス確認
    console.log('【4】注文ステータス確認...');
    const status = await client.getOrderStatus(order.orderId);
    console.log(`   ${order.orderId} → ${status.status}\n`);

    // ⑥ 注文キャンセル
    console.log('【5】注文キャンセル...');
    await client.cancelOrder(order.orderId);
    console.log(`   キャンセル完了\n`);

    // ⑦ 暗号化テスト
    console.log('【6】APIキー暗号化テスト...');
    const masterKey = crypto.randomBytes(32).toString('hex');
    const encrypted = encryptApiKey('my_secret_api_key', masterKey);
    const decrypted = decryptApiKey(encrypted, masterKey);
    console.log(`   暗号化: ${encrypted.slice(0, 40)}...`);
    console.log(`   復号: ${decrypted === 'my_secret_api_key' ? '✅ 一致' : '❌ 不一致'}\n`);

    console.log('=== テスト完了 ✅ ===');
  })().catch(console.error);
}
