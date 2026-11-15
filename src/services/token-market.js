const crypto = require('node:crypto');
const { state, systemAccount, save } = require('../store');

const CANDLE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_CANDLES = 24 * 14;
const TRADE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_BURN_FEE = 0.005;
const MAX_BURN_FEE = 0.20;
const TARGET_RATE_DEFAULT = 0.05;

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTargetRate() {
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  const configured = safeNumber(state.settings.token_target_rate, TARGET_RATE_DEFAULT);
  return configured > 0 ? configured : TARGET_RATE_DEFAULT;
}

function getRecentTrades(nowMs = Date.now()) {
  if (!Array.isArray(state.token_market_trades)) state.token_market_trades = [];
  const cutoff = nowMs - TRADE_WINDOW_MS;
  return state.token_market_trades
    .filter(trade => {
      const timestamp = Date.parse(trade.created_at || '');
      return Number.isFinite(timestamp) && timestamp >= cutoff &&
        safeNumber(trade.amount_scrl) > 0 && safeNumber(trade.amount_vrub) > 0;
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-2000);
}

function calculateMarketPrice(trades, fallbackRate) {
  const validTrades = Array.isArray(trades) ? trades.filter(trade =>
    safeNumber(trade.amount_scrl) > 0 && safeNumber(trade.amount_vrub) > 0
  ) : [];
  if (!validTrades.length) {
    return {
      price: fallbackRate,
      vwapPrice: fallbackRate,
      volumeScRl: 0,
      volumeVrub: 0,
      tradeCount: 0,
      lastTradeAt: null,
      source: 'live_balance_ratio'
    };
  }

  const volumeScRl = validTrades.reduce((sum, trade) => sum + safeNumber(trade.amount_scrl), 0);
  const volumeVrub = validTrades.reduce((sum, trade) => sum + safeNumber(trade.amount_vrub), 0);
  const latest = validTrades[validTrades.length - 1];
  const latestPrice = safeNumber(latest.amount_vrub) / safeNumber(latest.amount_scrl);
  const vwapPrice = volumeScRl > 0 ? volumeVrub / volumeScRl : fallbackRate;

  return {
    // The current market price follows the latest completed exchange immediately.
    // The seven-day VWAP remains visible as a separate historical indicator.
    price: latestPrice,
    vwapPrice,
    volumeScRl,
    volumeVrub,
    tradeCount: validTrades.length,
    lastTradeAt: latest.created_at || null,
    source: 'last_executed_trade'
  };
}

function getBurnFeeRate(coverageRatio) {
  const coverage = Math.max(0, safeNumber(coverageRatio, 0));
  if (coverage < 1) {
    const deficit = 1 - coverage;
    return Math.min(MAX_BURN_FEE, BASE_BURN_FEE + deficit * 0.20);
  }
  // When the supply is fully covered, the fee gradually falls to zero.
  return Math.max(0, BASE_BURN_FEE - Math.max(0, coverage - 1) * BASE_BURN_FEE);
}

function getTokenMarketStats(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const studentIds = new Set(state.users.filter(user => user.role === 'student').map(user => user.id));
  const userAccounts = state.accounts.filter(account => studentIds.has(account.user_id));

  // Only participant-held ScRl is in circulation. The system reserve is
  // inventory that can be issued later; burned tokens are permanently removed.
  const circulatingScRl = userAccounts
    .filter(account => account.kind === 'available' || account.kind === 'held')
    .reduce((sum, account) => sum + Math.max(0, safeNumber(account.balance)), 0);
  const virtualRubleSupply = userAccounts
    .filter(account => account.kind === 'vrub' || account.kind === 'vrub_held')
    .reduce((sum, account) => sum + Math.max(0, safeNumber(account.balance)), 0);
  const reserveScRl = Math.max(0, safeNumber((systemAccount('reserve') || {}).balance));
  const burnedScRl = Math.max(0, safeNumber((systemAccount('burn') || {}).balance));
  const targetRate = getTargetRate();

  // At targetRate V-RUB per ScRl, this is the largest circulating supply
  // that the current V-RUB mass can support.
  const maxSupportedScRl = targetRate > 0 ? Math.floor(virtualRubleSupply / targetRate) : 0;
  const backedRate = circulatingScRl > 0 ? virtualRubleSupply / circulatingScRl : targetRate;
  const totalSupplyScRl = circulatingScRl + reserveScRl;
  const totalCreatedScRl = totalSupplyScRl + burnedScRl;
  const coverageRatio = circulatingScRl > 0
    ? virtualRubleSupply / (circulatingScRl * targetRate)
    : (virtualRubleSupply > 0 ? 1 : 0);
  const excessScRl = Math.max(0, circulatingScRl - maxSupportedScRl);
  const remainingCapacityScRl = Math.max(0, maxSupportedScRl - circulatingScRl);

  const trades = getRecentTrades(safeNow);
  const market = calculateMarketPrice(trades, backedRate);
  const burnFeeRate = getBurnFeeRate(coverageRatio);

  return {
    circulatingScRl,
    reserveScRl,
    burnedScRl,
    totalSupplyScRl,
    totalCreatedScRl,
    virtualRubleSupply,
    targetRate: Number(targetRate.toFixed(6)),
    maxSupportedScRl,
    remainingCapacityScRl,
    excessScRl,
    backedRate: Number(backedRate.toFixed(6)),
    coverageRatio: Number(coverageRatio.toFixed(6)),
    // referenceRate is the live ratio of all student-held V-RUB to circulating ScRl.
    // marketPrice is the latest executed trade; these are intentionally separate.
    marketPrice: Number(market.price.toFixed(6)),
    lastTradePrice: Number(market.price.toFixed(6)),
    vwapPrice: Number(market.vwapPrice.toFixed(6)),
    referenceRate: Number(backedRate.toFixed(6)),
    marketPriceSource: market.source,
    lastTradeAt: market.lastTradeAt,
    marketVolumeScRl: market.volumeScRl,
    marketVolumeVrub: market.volumeVrub,
    marketTradeCount: market.tradeCount,
    burnFeeRate: Number(burnFeeRate.toFixed(6)),
    realRubAvailable: 0,
    formula: 'Текущее соотношение = все V-RUB участников / все ScRl в обращении; последняя рыночная цена = последняя исполненная сделка',
    backingFormula: 'Максимум ScRl в обращении = V-RUB всех учеников / целевой курс'
  };
}

function calculateBurnCommission(grossScRl, stats = getTokenMarketStats()) {
  const amount = Math.floor(safeNumber(grossScRl));
  if (amount <= 1) return 0;
  return Math.min(amount - 1, Math.floor(amount * stats.burnFeeRate));
}

function canIssueScRl(amount, stats = getTokenMarketStats()) {
  const value = Math.floor(safeNumber(amount));
  if (value <= 0) return { allowed: false, reason: 'invalid_amount', capacityLeft: stats.remainingCapacityScRl };
  return {
    allowed: stats.circulatingScRl + value <= stats.maxSupportedScRl,
    reason: stats.circulatingScRl + value <= stats.maxSupportedScRl ? null : 'backing_limit',
    capacityLeft: stats.remainingCapacityScRl,
    requested: value,
    maximum: stats.maxSupportedScRl
  };
}

function updateCandle(price, now = new Date(), volumeScRl = 0) {
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  const bucketStart = Math.floor(safeTimestamp / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
  const bucket = new Date(bucketStart).toISOString();
  let candle = state.token_rate_candles.find(item => item.bucket === bucket);

  // Earlier candles stored a balance ratio, not an executed market price.
  if (candle && candle.model !== 'market_spot_v2') {
    state.token_rate_candles = state.token_rate_candles.filter(item => item.bucket !== bucket);
    candle = null;
  }

  let changed = false;
  if (!candle) {
    candle = {
      bucket,
      model: 'market_spot_v2',
      open: price,
      high: price,
      low: price,
      close: price,
      volume_scrl: Math.max(0, volumeScRl),
      samples: volumeScRl > 0 ? 1 : 0,
      updated_at: new Date(safeTimestamp).toISOString()
    };
    state.token_rate_candles.push(candle);
    changed = true;
  } else {
    const nextHigh = Math.max(safeNumber(candle.high, price), price);
    const nextLow = Math.min(safeNumber(candle.low, price), price);
    const nextVolume = safeNumber(candle.volume_scrl) + Math.max(0, volumeScRl);
    if (nextHigh !== candle.high || nextLow !== candle.low ||
        price !== candle.close || volumeScRl > 0) {
      candle.high = nextHigh;
      candle.low = nextLow;
      candle.close = price;
      candle.volume_scrl = nextVolume;
      candle.samples = safeNumber(candle.samples) + 1;
      candle.updated_at = new Date(safeTimestamp).toISOString();
      changed = true;
    }
  }

  if (changed) {
    state.token_rate_candles.sort((a, b) => a.bucket.localeCompare(b.bucket));
    if (state.token_rate_candles.length > MAX_CANDLES) {
      state.token_rate_candles.splice(0, state.token_rate_candles.length - MAX_CANDLES);
    }
  }
  return changed;
}

function persistBackedRate(rate) {
  const previousRate = safeNumber(state.settings.token_backed_rate, -1);
  if (previousRate === rate) return false;
  state.settings.token_backed_rate = rate;
  state.settings.token_backed_rate_updated_at = new Date().toISOString();
  return true;
}

function persistCurrentPrice(price) {
  const previousRate = safeNumber(state.settings.token_exchange_rate, -1);
  if (previousRate === price) return false;
  state.settings.token_exchange_rate = price;
  state.settings.token_exchange_rate_version = (safeNumber(state.settings.token_exchange_rate_version) || 0) + 1;
  return true;
}

function recordTokenRateCandle(now = new Date()) {
  const stats = getTokenMarketStats(now);
  const candleChanged = updateCandle(stats.marketPrice, now, 0);
  const rateChanged = persistCurrentPrice(stats.marketPrice);
  const backedRateChanged = persistBackedRate(stats.backedRate);
  if (candleChanged || rateChanged || backedRateChanged) save();
  return {
    ...stats,
    candles: state.token_rate_candles.filter(item => item.model === 'market_spot_v2').slice(-MAX_CANDLES)
  };
}

function recordTokenMarketTrade(data) {
  if (!data || !data.orderId) throw new Error('A market trade needs an order ID');
  if (!Array.isArray(state.token_market_trades)) state.token_market_trades = [];
  const existing = state.token_market_trades.find(item => item.order_id === data.orderId);
  if (existing) return getTokenMarketStats();

  const amountScRl = Math.floor(safeNumber(data.amountScRl));
  const amountVrub = Math.floor(safeNumber(data.amountVrub));
  if (amountScRl <= 0 || amountVrub <= 0) throw new Error('A market trade needs positive ScRl and V-RUB volume');

  const now = data.createdAt ? new Date(data.createdAt) : new Date();
  const createdAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  state.token_market_trades.push({
    id: crypto.randomUUID(),
    order_id: String(data.orderId),
    side: data.side === 'sell_vrub' ? 'sell_vrub' : 'sell_scrl',
    buyer_id: data.buyerId || null,
    seller_id: data.sellerId || null,
    amount_scrl: amountScRl,
    amount_vrub: amountVrub,
    fee_scrl: Math.floor(safeNumber(data.feeScRl)),
    created_at: createdAt
  });

  const cutoff = Date.parse(createdAt) - 30 * 24 * 60 * 60 * 1000;
  state.token_market_trades = state.token_market_trades
    .filter(item => Date.parse(item.created_at) >= cutoff)
    .slice(-2000);

  const stats = getTokenMarketStats(createdAt);
  updateCandle(stats.marketPrice, createdAt, amountScRl);
  persistCurrentPrice(stats.marketPrice);
  persistBackedRate(stats.backedRate);
  save();

  return {
    ...stats,
    candles: state.token_rate_candles.filter(item => item.model === 'market_vwap_v1').slice(-MAX_CANDLES)
  };
}

module.exports = {
  getTokenMarketStats,
  recordTokenRateCandle,
  recordTokenMarketTrade,
  calculateBurnCommission,
  canIssueScRl,
  getBurnFeeRate
};
