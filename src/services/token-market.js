const { state, systemAccount, save } = require('../store');

const CANDLE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_CANDLES = 24 * 14;

function getTokenMarketStats() {
  const studentIds = new Set(state.users.filter(user => user.role === 'student').map(user => user.id));
  const userAccounts = state.accounts.filter(account => studentIds.has(account.user_id));
  const circulatingScRl = userAccounts
    .filter(account => account.kind === 'available' || account.kind === 'held')
    .reduce((sum, account) => sum + Math.max(0, Number(account.balance) || 0), 0);
  const virtualRubleSupply = userAccounts
    .filter(account => account.kind === 'vrub' || account.kind === 'vrub_held')
    .reduce((sum, account) => sum + Math.max(0, Number(account.balance) || 0), 0);
  const reserveScRl = Math.max(0, Number((systemAccount('reserve') || {}).balance) || 0);
  const burnedScRl = Math.max(0, Number((systemAccount('burn') || {}).balance) || 0);
  const totalIssuedScRl = circulatingScRl + reserveScRl + burnedScRl;
  const referenceRate = totalIssuedScRl > 0
    ? virtualRubleSupply / totalIssuedScRl
    : 0;

  return {
    circulatingScRl,
    reserveScRl,
    burnedScRl,
    totalIssuedScRl,
    virtualRubleSupply,
    referenceRate: Number(referenceRate.toFixed(6)),
    realRubAvailable: 0,
    formula: 'V-RUB в кошельках участников / весь выпуск ScRl (участники + резерв + сожжённые токены)'
  };
}

function recordTokenRateCandle(now = new Date()) {
  const stats = getTokenMarketStats();
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  const bucketStart = Math.floor(safeTimestamp / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
  const bucket = new Date(bucketStart).toISOString();
  const price = stats.referenceRate;
  let candle = state.token_rate_candles.find(item => item.bucket === bucket);
  let changed = false;

  if (!candle) {
    candle = {
      bucket,
      open: price,
      high: price,
      low: price,
      close: price,
      samples: 1,
      updated_at: new Date(safeTimestamp).toISOString()
    };
    state.token_rate_candles.push(candle);
    changed = true;
  } else {
    const high = Math.max(Number(candle.high) || price, price);
    const low = Math.min(Number(candle.low) || price, price);
    const close = price;
    if (high !== candle.high || low !== candle.low || close !== candle.close) changed = true;
    candle.high = high;
    candle.low = low;
    candle.close = close;
    candle.samples = (Number(candle.samples) || 0) + 1;
    changed = true;
    candle.updated_at = new Date(safeTimestamp).toISOString();
  }

  state.token_rate_candles.sort((a, b) => a.bucket.localeCompare(b.bucket));
  if (state.token_rate_candles.length > MAX_CANDLES) {
    state.token_rate_candles.splice(0, state.token_rate_candles.length - MAX_CANDLES);
    changed = true;
  }
  const previousRate = Number(state.settings.token_exchange_rate);
  if (!Number.isFinite(previousRate) || previousRate !== price) {
    state.settings.token_exchange_rate = price;
    state.settings.token_exchange_rate_version = (Number(state.settings.token_exchange_rate_version) || 0) + 1;
    changed = true;
  }
  if (changed) save();

  return {
    ...stats,
    candles: state.token_rate_candles.slice(-24)
  };
}

module.exports = { getTokenMarketStats, recordTokenRateCandle };
