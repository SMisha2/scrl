const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

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
      saves.push(JSON.stringify(state.token_rate_candles));
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
    users: [
      { id: 'student-1', role: 'student' },
      { id: 'teacher-1', role: 'teacher' }
    ],
    accounts: [
      { id: 'a1', user_id: 'student-1', kind: 'available', balance: 200 },
      { id: 'a2', user_id: 'student-1', kind: 'held', balance: 50 },
      { id: 'a3', user_id: 'student-1', kind: 'vrub', balance: 100 },
      { id: 'a4', user_id: 'student-1', kind: 'vrub_held', balance: 25 },
      { id: 'a5', user_id: null, kind: 'reserve', balance: 700 },
      { id: 'a6', user_id: null, kind: 'burn', balance: 50 },
      { id: 'a7', user_id: 'teacher-1', kind: 'available', balance: 9000 }
    ],
    settings: {},
    token_rate_candles: []
  };
}

test('calculates internal rate from all V-RUB and total ScRl issuance', () => {
  const state = createState();
  const { market } = loadMarketWithState(state);
  const stats = market.getTokenMarketStats();
  assert.equal(stats.circulatingScRl, 250);
  assert.equal(stats.virtualRubleSupply, 125);
  assert.equal(stats.reserveScRl, 700);
  assert.equal(stats.burnedScRl, 50);
  assert.equal(stats.totalIssuedScRl, 1000);
  assert.equal(stats.referenceRate, 0.125);
  assert.equal(stats.realRubAvailable, 0);
});

test('records hourly OHLC candles and updates the reference rate', () => {
  const state = createState();
  const { market, saves } = loadMarketWithState(state);
  const start = new Date('2026-11-15T12:00:00.000Z');
  const first = market.recordTokenRateCandle(start);
  assert.equal(first.candles.length, 1);
  assert.equal(first.candles[0].open, 0.125);

  state.accounts.find(account => account.kind === 'vrub').balance = 200;
  const second = market.recordTokenRateCandle(new Date(start.getTime() + 15 * 60 * 1000));
  const candle = second.candles[0];
  assert.equal(candle.open, 0.125);
  assert.equal(candle.high, 0.225);
  assert.equal(candle.low, 0.125);
  assert.equal(candle.close, 0.225);
  assert.equal(candle.samples, 2);
  assert.equal(state.settings.token_exchange_rate, 0.225);
  assert.ok(saves.length >= 2);
});

test('ignores non-student account balances in the internal exchange rate', () => {
  const state = createState();
  const { market } = loadMarketWithState(state);
  const before = market.getTokenMarketStats().referenceRate;
  state.accounts.find(account => account.user_id === 'teacher-1').balance += 1000000;
  const after = market.getTokenMarketStats().referenceRate;
  assert.equal(after, before);
});
