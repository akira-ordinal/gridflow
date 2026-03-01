'use client';

/**
 * GridFlow ダッシュボード - メインコンポーネント
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid
} from 'recharts';

// ─── 子コンポーネント ──────────────────────────────────

/** 統計カード */
function MetricCard({ label, value, sub, color = '#00d4ff' }) {
  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1e2d45',
      borderRadius: 12,
      padding: '20px',
      borderTop: `2px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 2, marginBottom: 8, fontFamily: 'monospace' }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'monospace', marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>
    </div>
  );
}

/** グリッドレベル一行 */
function LevelRow({ level }) {
  const statusColors = { open: '#00d4ff', filled: '#00ff9d', pending: '#64748b', cancelled: '#ff4d6d' };
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 70px 90px 80px',
      padding: '8px 16px',
      borderBottom: '1px solid #1a2235',
      fontSize: 12,
      fontFamily: 'monospace',
      alignItems: 'center',
    }}>
      <span style={{ color: '#e2e8f0' }}>¥{level.price.toLocaleString()}</span>
      <span style={{ color: level.side === 'buy' ? '#00ff9d' : '#ff4d6d' }}>
        {level.side.toUpperCase()}
      </span>
      <span style={{ color: '#64748b', textAlign: 'right' }}>{level.qty}</span>
      <span style={{
        textAlign: 'right',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 10,
        background: `${statusColors[level.status]}18`,
        color: statusColors[level.status],
      }}>
        {level.status}
      </span>
    </div>
  );
}

/** リスク選択ボタン */
function RiskSelector({ value, onChange }) {
  const options = [
    { key: 'low',    label: 'LOW',    color: '#00ff9d' },
    { key: 'medium', label: 'MEDIUM', color: '#ffd166' },
    { key: 'high',   label: 'HIGH',   color: '#ff4d6d' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            padding: '8px',
            borderRadius: 8,
            border: `1px solid ${value === o.key ? o.color : '#1e2d45'}`,
            background: value === o.key ? `${o.color}14` : '#1a2235',
            color: value === o.key ? o.color : '#64748b',
            fontFamily: 'monospace',
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all .2s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── グリッドロジック（クライアントサイド計算）────────────

function buildLevels(upper, lower, count, budget) {
  const step = (upper - lower) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const price = Math.round(lower + step * i);
    const qty   = parseFloat((budget / count / price).toFixed(8));
    return { price, qty, side: i < Math.floor(count / 2) ? 'buy' : 'sell', status: 'pending' };
  });
}

function calcEstimate(upper, lower, count, budget) {
  const step        = (upper - lower) / (count - 1);
  const avg         = (upper + lower) / 2;
  const qty         = (budget / count) / avg;
  const profitPer   = step * qty;
  const dailyTrades = Math.round(count * 0.3);
  return {
    step:        Math.round(step),
    profitPer:   profitPer.toFixed(2),
    dailyTrades,
    dailyProfit: Math.round(profitPer * dailyTrades),
  };
}

const RISK_PRESETS = {
  low:    { spread: 0.05, gridCount: 10 },
  medium: { spread: 0.10, gridCount: 15 },
  high:   { spread: 0.20, gridCount: 20 },
};

// ─── メインダッシュボード ─────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  
  // フォーム状態
  const [symbol,     setSymbol]     = useState('btc_jpy');
  const [risk,       setRisk]       = useState('low');
  const [upperPrice, setUpperPrice] = useState(15225000);
  const [lowerPrice, setLowerPrice] = useState(13050000);
  const [gridCount,  setGridCount]  = useState(10);
  const [budget,     setBudget]     = useState(100000);

  // ボット状態
  const [running,      setRunning]      = useState(false);
  const [levels,       setLevels]       = useState([]);
  const [currentPrice, setCurrentPrice] = useState(14500000);
  const [totalProfit,  setTotalProfit]  = useState(0);
  const [totalTrades,  setTotalTrades]  = useState(0);
  const [startTime,    setStartTime]    = useState(null);
  const [uptime,       setUptime]       = useState('0:00');
  const [logs,         setLogs]         = useState([
    { time: '--:--:--', msg: 'System ready.', type: '' }
  ]);

  // 価格履歴（チャート用）
  const [priceHistory, setPriceHistory] = useState(
    Array.from({ length: 20 }, (_, i) => ({ t: i, price: 14500000 }))
  );

  const intervalsRef = useRef({});

  // ── BitTradeからリアルタイム価格取得 ──────
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api-cloud.bittrade.co.jp/market/detail/merged?symbol=btcjpy');
        const data = await res.json();
        if (data.tick?.close) {
          setCurrentPrice(Math.round(data.tick.close));
        }
      } catch (err) {
        console.error('価格取得エラー:', err);
      }
    };
    
    fetchPrice();
    const interval = setInterval(fetchPrice, 10000);
    
    return () => clearInterval(interval);
  }, []);

  // ── ログアウト処理 ──────────────────────────
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      console.error('ログアウトエラー:', err);
    }
  };

  // ── 試算更新 ────────────────────────────────────────
  const estimate = (upperPrice && lowerPrice && upperPrice > lowerPrice)
    ? calcEstimate(upperPrice, lowerPrice, gridCount, budget)
    : null;

  // ── リスク変更 → 価格自動計算 ──────────────────────
  const handleRiskChange = useCallback((r) => {
    setRisk(r);
    const { spread, gridCount: gc } = RISK_PRESETS[r];
    setUpperPrice(Math.round(currentPrice * (1 + spread)));
    setLowerPrice(Math.round(currentPrice * (1 - spread)));
    setGridCount(gc);
  }, [currentPrice]);

  // ── ログ追加 ────────────────────────────────────────
  const addLog = useCallback((msg, type = '') => {
    const time = new Date().toTimeString().slice(0, 8);
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50));
  }, []);

  // ── ボット起動 ──────────────────────────────────────
  const startBot = useCallback(async () => {
    const lvls = buildLevels(upperPrice, lowerPrice, gridCount, budget);
    setLevels(lvls.map(l => ({ ...l, status: 'open' })));
    setRunning(true);
    setStartTime(Date.now());
    setTotalProfit(0);
    setTotalTrades(0);
    addLog(`ボット起動 — グリッド${gridCount}本 / 予算¥${budget.toLocaleString()}`);
    addLog(`上限¥${upperPrice.toLocaleString()} → 下限¥${lowerPrice.toLocaleString()}`);

    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, upperPrice, lowerPrice, gridCount, budget, dryRun: true }),
      });
      const data = await res.json();
      if (data.success) addLog('✅ サーバーサイドボット起動完了');
      else addLog(`⚠️ サーバーエラー: ${data.error}`, 'error');
    } catch {
      addLog('(デモモード: APIサーバー未接続)', 'warn');
    }
  }, [symbol, upperPrice, lowerPrice, gridCount, budget, addLog]);

  // ── ボット停止 ──────────────────────────────────────
  const stopBot = useCallback(async () => {
    setRunning(false);
    setLevels([]);
    addLog('ボット停止 — 全注文キャンセル');
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
    } catch {}
    Object.values(intervalsRef.current).forEach(clearInterval);
  }, [addLog]);

  // ── シミュレーション（デモ用）──────────────────────
  useEffect(() => {
    if (!running) return;

    const priceTimer = setInterval(() => {
      setCurrentPrice(prev => {
        const next = Math.round(prev * (1 + (Math.random() - 0.5) * 0.006));
        setPriceHistory(h => [...h.slice(-29), { t: Date.now(), price: next }]);
        return next;
      });
    }, 3000);

    const tradeTimer = setInterval(() => {
      if (Math.random() > 0.25) return;
      setLevels(prev => {
        const openIdxs = prev.map((l, i) => i).filter(i => prev[i].status === 'open');
        if (!openIdxs.length) return prev;
        const idx = openIdxs[Math.floor(Math.random() * openIdxs.length)];
        const l = prev[idx];
        const step = (upperPrice - lowerPrice) / (gridCount - 1);
        const profit = step * l.qty;
        setTotalProfit(p => p + profit);
        setTotalTrades(t => t + 1);
        addLog(`✅ ${l.side.toUpperCase()} 約定 @¥${l.price.toLocaleString()} +¥${profit.toFixed(2)}`, 'trade');
        const updated = [...prev];
        updated[idx] = { ...l, status: 'filled' };
        setTimeout(() => setLevels(cur => {
          const r = [...cur];
          r[idx] = { ...r[idx], status: 'open', side: r[idx].side === 'buy' ? 'sell' : 'buy' };
          return r;
        }), 2000);
        return updated;
      });
    }, 8000);

    const uptimeTimer = setInterval(() => {
      setStartTime(s => {
        const sec = Math.floor((Date.now() - s) / 1000);
        setUptime(`${Math.floor(sec/3600)}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}`);
        return s;
      });
    }, 1000);

    intervalsRef.current = { priceTimer, tradeTimer, uptimeTimer };
    return () => { clearInterval(priceTimer); clearInterval(tradeTimer); clearInterval(uptimeTimer); };
  }, [running, upperPrice, lowerPrice, gridCount, addLog]);

  // ─── レンダリング ─────────────────────────────────
  const openOrders = levels.filter(l => l.status === 'open').length;
  const sortedLevels = [...levels].sort((a, b) => b.price - a.price).slice(0, 15);

  return (
    <div style={{ background: '#0a0e1a', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'sans-serif' }}>

      {/* ヘッダー */}
      <div style={{
        borderBottom: '1px solid #1e2d45',
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(10,14,26,0.95)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: '#00d4ff', letterSpacing: 2 }}>
          GRID<span style={{ color: '#00ff9d' }}>FLOW</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#64748b' }}>
            BTC/JPY ¥{currentPrice.toLocaleString()}
          </span>
          <button
            onClick={running ? stopBot : startBot}
            style={{
              padding: '6px 16px',
              borderRadius: 20,
              border: `1px solid ${running ? '#ff4d6d' : '#00ff9d'}`,
              background: running ? 'rgba(255,77,109,0.1)' : 'rgba(0,255,157,0.1)',
              color: running ? '#ff4d6d' : '#00ff9d',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: 'pointer',
              letterSpacing: 1,
            }}
          >
            {running ? '■ STOP' : '▶ START'}
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 16px',
              borderRadius: 20,
              border: '1px solid #64748b',
              background: 'transparent',
              color: '#64748b',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: 'pointer',
              letterSpacing: 1,
            }}
          >
            LOGOUT
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px' }}>

        {/* メトリクス */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
          <MetricCard label="累積利益"   value={`¥${Math.round(totalProfit).toLocaleString()}`} sub="運用開始から"  color="#00ff9d" />
          <MetricCard label="約定回数"   value={totalTrades}                                      sub="トータル"      color="#00d4ff" />
          <MetricCard label="稼働時間"   value={running ? uptime : '0:00'}                        sub="hh:mm"         color="#ffd166" />
          <MetricCard label="稼働中注文" value={openOrders}                                        sub="グリッド本数"  color="#a78bfa" />
        </div>

        {/* メインレイアウト */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>

          {/* 左カラム */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* 価格チャート */}
            <div style={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2d45', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00d4ff', letterSpacing: 1 }}>PRICE CHART</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{symbol.replace('_', '/').toUpperCase()}</span>
              </div>
              <div style={{ padding: '16px 8px 8px' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={priceHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                    <XAxis dataKey="t" hide />
                    <YAxis domain={['auto', 'auto']} tickFormatter={v => `¥${(v/10000).toFixed(0)}万`}
                      tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} width={60} />
                    <Tooltip
                      contentStyle={{ background: '#1a2235', border: '1px solid #1e2d45', borderRadius: 8 }}
                      labelStyle={{ display: 'none' }}
                      formatter={v => [`¥${v.toLocaleString()}`, '価格']}
                    />
                    {running && upperPrice && (
                      <ReferenceLine y={upperPrice} stroke="#ff4d6d" strokeDasharray="4 4" strokeOpacity={0.5} />
                    )}
                    {running && lowerPrice && (
                      <ReferenceLine y={lowerPrice} stroke="#00ff9d" strokeDasharray="4 4" strokeOpacity={0.5} />
                    )}
                    <Line type="monotone" dataKey="price" stroke="#00d4ff" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* グリッドレベル一覧 */}
            <div style={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2d45', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00d4ff', letterSpacing: 1 }}>ORDER LEVELS</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{levels.length} levels</span>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {sortedLevels.length ? sortedLevels.map((l, i) => (
                  <LevelRow key={i} level={l} />
                )) : (
                  <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>
                    ボットを起動するとグリッドが表示されます
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右カラム */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* BitTrade誘導バナー */}
            <a href="https://bittrade.co.jp" target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
              background: 'linear-gradient(135deg,rgba(0,212,255,.08),rgba(0,255,157,.08))',
              border: '1px solid rgba(0,212,255,.2)', borderRadius: 12, textDecoration: 'none',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#00d4ff,#00ff9d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>₿</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>BitTrade で口座開設</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>APIキーを取得してボットを連携</div>
              </div>
              <span style={{ color: '#00d4ff' }}>→</span>
            </a>

            {/* 設定パネル */}
            <div style={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2d45' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00d4ff', letterSpacing: 1 }}>BOT CONFIG</span>
              </div>
              <div style={{ padding: 16 }}>
                <label style={{ display: 'block', fontSize: 10, color: '#64748b', letterSpacing: 1, marginBottom: 6, fontFamily: 'monospace' }}>通貨ペア</label>
                <select value={symbol} onChange={e => setSymbol(e.target.value)}
                  style={{ width: '100%', background: '#1a2235', border: '1px solid #1e2d45', borderRadius: 8, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, padding: '9px 12px', marginBottom: 14, outline: 'none' }}>
                  <option value="btc_jpy">BTC / JPY</option>
                  <option value="eth_jpy">ETH / JPY</option>
                  <option value="xrp_jpy">XRP / JPY</option>
                </select>

                <label style={{ display: 'block', fontSize: 10, color: '#64748b', letterSpacing: 1, marginBottom: 6, fontFamily: 'monospace' }}>リスク設定</label>
                <RiskSelector value={risk} onChange={handleRiskChange} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: '上限価格', value: upperPrice, setter: setUpperPrice },
                    { label: '下限価格', value: lowerPrice, setter: setLowerPrice },
                    { label: 'グリッド本数', value: gridCount, setter: v => setGridCount(+v) },
                    { label: '運用金額(円)', value: budget, setter: v => setBudget(+v) },
                  ].map(({ label, value, setter }) => (
                    <div key={label}>
                      <label style={{ display: 'block', fontSize: 10, color: '#64748b', letterSpacing: 1, marginBottom: 4, fontFamily: 'monospace' }}>{label}</label>
                      <input type="number" value={value} onChange={e => setter(e.target.value)}
                        style={{ width: '100%', background: '#1a2235', border: '1px solid #1e2d45', borderRadius: 8, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, padding: '9px 12px', outline: 'none' }} />
                    </div>
                  ))}
                </div>

                <button
                  onClick={running ? stopBot : startBot}
                  style={{
                    width: '100%', padding: 13, borderRadius: 8,
                    border: running ? '1px solid #ff4d6d' : 'none',
                    background: running ? 'transparent' : 'linear-gradient(135deg,#00d4ff,#00ff9d)',
                    color: running ? '#ff4d6d' : '#0a0e1a',
                    fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
                    letterSpacing: 2, cursor: 'pointer',
                  }}
                >
                  {running ? '■ STOP BOT' : '▶ START BOT'}
                </button>
              </div>
            </div>

            {/* 収益試算 */}
            {estimate && (
              <div style={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 12 }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2d45' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00d4ff', letterSpacing: 1 }}>PROFIT ESTIMATE</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#1e2d45', margin: '0 16px 14px', borderRadius: 8, overflow: 'hidden' }}>
                  {[
                    { label: 'グリッド幅', val: `¥${estimate.step.toLocaleString()}` },
                    { label: '1取引利益', val: `¥${estimate.profitPer}` },
                    { label: '推定日次取引', val: `${estimate.dailyTrades}回` },
                    { label: '推定日次利益', val: `¥${estimate.dailyProfit.toLocaleString()}` },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ background: '#1a2235', padding: 12 }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#e2e8f0' }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ログ */}
            <div style={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2d45', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00d4ff', letterSpacing: 1 }}>ACTIVITY LOG</span>
                <button onClick={() => setLogs([])} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>CLR</button>
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto', padding: '4px 0' }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 16px', borderBottom: '1px solid #1a2235', fontFamily: 'monospace', fontSize: 11 }}>
                    <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{l.time}</span>
                    <span style={{ color: l.type === 'trade' ? '#00ff9d' : l.type === 'error' ? '#ff4d6d' : '#e2e8f0' }}>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}