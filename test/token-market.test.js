const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadMarketWithState(state) {
  const storePath = require.resolve('../src/store');
  const marketPath = require.resolve('../src/services/token-market');
  const originalStore = require.cache[storePath];
  const originalMarket = require.cache[marketPath];
  const storeStub = new Module(storePath);
  storeStub.filename = storePath;
  storeStub.loaded = true;
  const saves = [];
  storeStub.exports = {
    state,
    systemAccount(kind) {
      return state.accounts.find(account => account.user_id === null && account.kind === kind) || null;
    },
    save() {
      saves.push(JSON.stringify({
        trades: state.token_market_trades,
        candles: state.token_rate_candles,
        price: state.settings.token_exchange_rate
      }));
    }
  };
  require.cache[storePath] = storeStub;
  delete require.cache[marketPath];
  try {
    const market = require(marketPath);
    return { market, saves };
  } finally {
    if (originalStore) require.cache[storePath] = originalStore;
    else delete require.cache[storePath];
    if (originalMarket) require.cache[marketPath] = originalMarket;
    else delete require.cache[marketPath];
  }
}

function createState() {
  return {
    users: [{ id: 'student-1', role: 'student' }, { id: 'teacher-1', role: 'teacher' }],
    accounts: [
      { id: 'a1', user_id: 'student-1', kind: 'available', balance: 60000 },
      { id: 'a2', user_id: 'student-1', kind: 'held', balance: 40000 },
      { id: 'a3', user_id: 'student-1', kind: 'vrub', balance: 3000 },
      { id: 'a4', user_id: 'student-1', kind: 'vrub_held', balance: 1000 },
      { id: 'a5', user_id: null, kind: 'reserve', balance: 100000 },
      { id: 'a6', user_id: null, kind: 'burn', balance: 10000 },
      { id: 'a7', user_id: 'teacher-1', kind: 'available', balance: 9000 }
    ],
    settings: { token_target_rate: 0.05, token_exchange_rate: 0.05, token_exchange_rate_version: 1 },
    token_rate_candles: [],
    token_market_trades: []
  };
}

test('4,000 V-RUB at a 0.05 target supports at most 80,000 circulating ScRl', () => {
  const state = createState();
  const { market } = loadMarketWithState(state);
  const stats = market.getTokenMarketStats();
  assert.equal(stats.virtualRubleSupply, 4000);
  assert.equal(stats.circulatingScRl, 100000);
  assert.equal(stats.maxSupportedScRl, 80000);
  assert.equal(stats.excessScRl, 20000);
  assert.equal(stats.remainingCapacityScRl, 0);
  assert.equal(stats.coverageRatio, 0.8);
  assert.equal(stats.backedRate, 0.04);
  assert.equal(stats.marketPrice, 0.05);
  // System reserve and already-burned tokens do not count as circulation.
  assert.equal(stats.reserveScRl, 100000);
  assert.equal(stats.burnedScRl, 10000);
  assert.equal(stats.totalSupplyScRl, 200000);
});

test('dynamic burn fee rises when supply exceeds its V-RUB-backed limit', () => {
  const state = createState();
  const { market } = loadMarketWithState(state);
  const stats = market.getTokenMarketStats();
  assert.equal(stats.burnFeeRate, market.getBurnFeeRate(stats.coverageRatio));
  assert.equal(stats.burnFeeRate, 0.045);
  assert.equal(market.calculateBurnCommission(1000, stats), Math.floor(1000 * stats.burnFeeRate));
  assert.equal(market.calculateBurnCommission(1, stats), 0);
});

test('burn fee falls to zero when supply has at least twice the target coverage', () => {
  const state = createState();
  state.accounts.find(account => account.kind === 'available').balance = 1000;
  state.accounts.find(account => account.kind === 'held').balance = 0;
  state.accounts.find(account => account.id === 'a7').balance = 0;
  const { market } = loadMarketWithState(state);
  const stats = market.getTokenMarketStats();
  assert.equal(stats.coverageRatio, 80);
  assert.equal(stats.burnFeeRate, 0);
  assert.equal(market.calculateBurnCommission(1000, stats), 0);
});

test('new ScRl issuance is blocked when it exceeds the backed capacity', () => {
  const state = createState();
  state.accounts.find(account => account.kind === 'available').balance = 30000;
  state.accounts.find(account => account.kind === 'held').balance = 0;
  state.accounts.find(account => account.id === 'a7').balance = 0;
  const { market } = loadMarketWithState(state);
  assert.equal(market.canIssueScRl(10000).allowed, true);
  assert.equal(market.canIssueScRl(50000).allowed, false);
});

test('executed trades move the market price using seven-day volume-weighted price', () => {
  const state = createState();
  const { market, saves } = loadMarketWithState(state);
  const start = new Date('2026-11-15T12:00:00.000Z');
  const first = market.recordTokenMarketTrade({
    orderId: 'order-1', side: 'sell_scrl',
    amountScRl: 100, amountVrub: 10, feeScRl: 1,
    buyerId: 'student-1', sellerId: 'teacher-1', createdAt: start
  });
  assert.equal(first.marketPrice, 0.1);
  assert.equal(first.marketTradeCount, 1);

  const second = market.recordTokenMarketTrade({
    orderId: 'order-2', side: 'sell_vrub',
    amountScRl: 1000, amountVrub: 25, feeScRl: 5,
    buyerId: 'teacher-1', sellerId: 'student-1',
    createdAt: new Date(start.getTime() + 15 * 60 * 1000)
  });
  assert.equal(second.marketTradeCount, 2);
  assert.equal(second.marketVolumeScRl, 1100);
  assert.equal(second.marketVolumeVrub, 35);
  assert.equal(second.marketPrice, Number((35 / 1100).toFixed(6)));
  const candle = second.candles[0];
  assert.equal(candle.open, 0.1);
  assert.equal(candle.high, 0.1);
  assert.equal(candle.close, second.marketPrice);
  assert.ok(candle.low < 0.1);
  assert.equal(candle.volume_scrl, 1100);
  assert.equal(saves.length, 2);
});

test('an order cannot create two market trades', () => {
  const state = createState();
  const { market } = loadMarketWithState(state);
  const trade = {
    orderId: 'same-order', side: 'sell_scrl',
    amountScRl: 100, amountVrub: 10, feeScRl: 0
  };
  market.recordTokenMarketTrade(trade);
  const second = market.recordTokenMarketTrade(trade);
  assert.equal(state.token_market_trades.length, 1);
  assert.equal(second.marketTradeCount, 1);
});
