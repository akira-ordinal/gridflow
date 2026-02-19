-- ============================================================
-- GridFlow — PostgreSQL スキーマ定義
-- 実行: psql -d gridflow -f schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ユーザー
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE
);

-- 2. APIキー（暗号化保存 / AES-256）
-- ⚠️ api_key / api_secret は絶対に平文で保存しないこと！
CREATE TABLE IF NOT EXISTS api_credentials (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange         TEXT        NOT NULL DEFAULT 'bittrade',
  api_key_enc      BYTEA       NOT NULL,
  api_secret_enc   BYTEA       NOT NULL,
  is_verified      BOOLEAN     NOT NULL DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, exchange)
);

-- 3. ボット設定
CREATE TABLE IF NOT EXISTS bots (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT          NOT NULL DEFAULT 'My Grid Bot',
  symbol        TEXT          NOT NULL,
  upper_price   NUMERIC(18,0) NOT NULL,
  lower_price   NUMERIC(18,0) NOT NULL,
  grid_count    INT           NOT NULL CHECK (grid_count BETWEEN 2 AND 100),
  total_budget  NUMERIC(18,2) NOT NULL,
  is_dry_run    BOOLEAN       NOT NULL DEFAULT TRUE,
  state         TEXT          NOT NULL DEFAULT 'stopped'
                              CHECK (state IN ('stopped','running','error')),
  started_at    TIMESTAMPTZ,
  stopped_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 4. グリッドレベル（注文一覧）
CREATE TABLE IF NOT EXISTS grid_levels (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id            UUID          NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  price             NUMERIC(18,0) NOT NULL,
  quantity          NUMERIC(18,8) NOT NULL,
  side              TEXT          NOT NULL CHECK (side IN ('buy','sell')),
  exchange_order_id TEXT,
  status            TEXT          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','open','filled','cancelled')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 5. 約定履歴
CREATE TABLE IF NOT EXISTS trades (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_id        UUID          NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id),
  grid_level_id UUID          REFERENCES grid_levels(id),
  symbol        TEXT          NOT NULL,
  side          TEXT          NOT NULL CHECK (side IN ('buy','sell')),
  price         NUMERIC(18,0) NOT NULL,
  quantity      NUMERIC(18,8) NOT NULL,
  fee           NUMERIC(18,8) NOT NULL DEFAULT 0,
  profit        NUMERIC(18,2),
  executed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 6. サマリービュー
CREATE OR REPLACE VIEW bot_stats AS
SELECT
  b.id                          AS bot_id,
  b.user_id,
  b.name,
  b.symbol,
  b.state,
  COUNT(t.id)                   AS total_trades,
  COALESCE(SUM(t.profit), 0)   AS total_profit,
  MIN(t.executed_at)            AS first_trade_at,
  MAX(t.executed_at)            AS last_trade_at,
  b.started_at,
  b.total_budget
FROM bots b
LEFT JOIN trades t ON t.bot_id = b.id
GROUP BY b.id;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_bots_user_id       ON bots(user_id);
CREATE INDEX IF NOT EXISTS idx_grid_levels_bot_id ON grid_levels(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id      ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);

-- 更新日時の自動更新
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated  BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bots_updated   BEFORE UPDATE ON bots       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_levels_updated BEFORE UPDATE ON grid_levels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
