const fs = require('node:fs');
const crypto = require('node:crypto');
const { DATA_FILE } = require('./config');
const { hashPassword } = require('./security');
function seedData() {
  const now = new Date().toISOString();
  const s = {
    users: [], accounts: [], transactions: [], entries: [],
    listings: [], orders: [], auctions: [], bids: [], exchange_orders: [],
    demands: [], offers: [], applications: [], deals: [], notifications: [],
    favorites: [], reports: [], moderation_cases: [], ai_messages: [], deal_messages: [], reviews: [],
    money_operations: [], audit_logs: [], vrub_ledger_entries: []
  };
  const reserveId = crypto.randomUUID();
  const burnId = crypto.randomUUID();
  s.accounts.push({ id: reserveId, user_id: null, kind: 'reserve', balance: 100000 });
  s.accounts.push({ id: burnId, user_id: null, kind: 'burn', balance: 0 });

  const demoUsers = [
    { email: 'ivan@scrl.demo',    name: 'Иван Петров',    role: 'student', cls: '8А', birth: '2010-05-15' },
    { email: 'masha@scrl.demo',   name: 'Мария Сидорова', role: 'student', cls: '9Б', birth: '2009-08-20' },
    { email: 'petya@scrl.demo',   name: 'Пётр Смирнов',   role: 'student', cls: '6В', birth: '2013-03-10' },
    { email: 'teacher@scrl.demo', name: 'Анна Ивановна',  role: 'teacher', cls: '8А', birth: null },
    { email: 'admin@scrl.demo',   name: 'Администратор',  role: 'admin',   cls: null, birth: null }
  ];

  for (const u of demoUsers) {
    const id = crypto.randomUUID();
    s.users.push({
      id, email: u.email, password_hash: hashPassword('password123'),
      role: u.role, full_name: u.name, class_name: u.cls,
      birth_date: u.birth, is_blocked: false, created_at: now
    });
    const avId = crypto.randomUUID();
    s.accounts.push({ id: avId, user_id: id, kind: 'available', balance: 0 });
    s.accounts.push({ id: crypto.randomUUID(), user_id: id, kind: 'held', balance: 0 });
    if (u.role === 'student') {
      s.accounts.push({ id: crypto.randomUUID(), user_id: id, kind: 'vrub', balance: 1000 });
      const txId = crypto.randomUUID();
      s.transactions.push({ id: txId, kind: 'signup_bonus', initiator_id: id, payload: { amount: 100 }, created_at: now });
      s.entries.push({ id: crypto.randomUUID(), tx_id: txId, account_id: reserveId, amount: -100, note: null, created_at: now });
      s.entries.push({ id: crypto.randomUUID(), tx_id: txId, account_id: avId, amount: 100, note: null, created_at: now });
      s.accounts.find(a => a.id === reserveId).balance -= 100;
      s.accounts.find(a => a.id === avId).balance += 100;
    }
  }

  const masha = s.users.find(u => u.email === 'masha@scrl.demo');
  if (masha) {
    s.listings.push({
      id: crypto.randomUUID(), seller_id: masha.id,
      title: 'Помогу с английским', category: 'Языки',
      description: 'Разговорный английский, помощь с домашкой',
      price: 50, status: 'active', created_at: now
    });
  }

  const teacher = s.users.find(u => u.email === 'teacher@scrl.demo');
  if (teacher) {
    s.auctions.push({
      id: crypto.randomUUID(), title: 'Пицца на класс', prize: 'Пицца',
      start_price: 100, min_step: 10, current_bid: 0, current_winner_id: null,
      ends_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      status: 'active', created_by: teacher.id, created_at: now
    });
  }

  return s;
}


let state;
if (fs.existsSync(DATA_FILE)) {
  state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} else {
  state = seedData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}


function save() {
  const temporaryFile = DATA_FILE + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryFile, DATA_FILE);
  } catch (error) {
    try { if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile); } catch {}
    throw error;
  }
}

// Backward-compatible schema extension for existing scrl-data.json files.
const COLLECTIONS = [
  'demands', 'offers', 'applications', 'deals', 'notifications',
  'favorites', 'reports', 'moderation_cases', 'ai_messages', 'deal_messages', 'reviews',
  'money_operations', 'audit_logs'
];
let migrated = false;
for (const name of COLLECTIONS) {
  if (!Array.isArray(state[name])) {
    state[name] = [];
    migrated = true;
  }
}
if (migrated) save();



function ensureCollections() {
  const collections = [
    'demand_posts', 'offer_posts', 'applications', 'deals', 'deal_messages',
    'notifications', 'favorites', 'reviews', 'reports', 'moderation_cases',
    'moderation_actions', 'admin_audit_logs', 'ai_messages', 'money_operations',
    'token_lots', 'token_ledger_entries', 'token_policy_versions',
    'funding_sources', 'funding_reserves', 'payment_intents', 'payout_requests',
    'provider_events', 'partner_settlements', 'refund_operations',
    'withdrawal_eligibility_checks', 'guardian_links', 'consent_records',
    'financial_audit_logs', 'token_rate_candles', 'vrub_ledger_entries'
  ];
  let changed = false;
  for (const name of collections) {
    if (!Array.isArray(state[name])) {
      state[name] = [];
      changed = true;
    }
  }
  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = {
      payments_mode: 'disabled',
      token_exchange_rate: 1,
      token_exchange_rate_version: 1,
      marketplace_commission_percent: 0,
      teacher_weekly_limit: 500
    };
    changed = true;
  }
  // Every student has a separate V-RUB escrow account for exchange listings.
  for (const user of state.users.filter(item => item.role === 'student')) {
    if (!state.accounts.some(item => item.user_id === user.id && item.kind === 'vrub_held')) {
      state.accounts.push({ id: crypto.randomUUID(), user_id: user.id, kind: 'vrub_held', balance: 0 });
      changed = true;
    }
  }
  if (state.settings.vrub_initial_grant_migrated !== true) {
    for (const user of state.users.filter(item => item.role === 'student')) {
      const vrub = account(user.id, 'vrub');
      const vrubHeld = account(user.id, 'vrub_held');
      const totalVrubBalance = (Number(vrub.balance) || 0) + (Number(vrubHeld.balance) || 0);
      const hasHistory = state.entries.some(entry => entry.account_id === vrub.id || entry.account_id === vrubHeld.id);
      const hasOpeningRecord = state.vrub_ledger_entries.some(entry =>
        entry.user_id === user.id && ['initial_grant', 'opening_balance'].includes(entry.event_type)
      );
      if (!hasOpeningRecord) {
        if (totalVrubBalance > 0) {
          state.vrub_ledger_entries.push({
            id: crypto.randomUUID(), user_id: user.id, event_type: 'opening_balance',
            amount: totalVrubBalance, reason: 'Existing V-RUB balance preserved during migration',
            created_at: new Date().toISOString()
          });
        } else if (!hasHistory) {
          grantStartingVrub(user.id, 'migration');
        } else {
          state.vrub_ledger_entries.push({
            id: crypto.randomUUID(), user_id: user.id, event_type: 'legacy_zero_balance',
            amount: 0, reason: 'Existing V-RUB transaction history found; no second grant issued',
            created_at: new Date().toISOString()
          });
        }
      }
    }
    state.settings.vrub_initial_grant_migrated = true;
    changed = true;
  }
  if (!state.demand_posts.length && !state.offer_posts.length) {
    const ivan = state.users.find(u => u.email === 'ivan@scrl.demo');
    const masha = state.users.find(u => u.email === 'masha@scrl.demo');
    const now = new Date().toISOString();
    if (ivan) state.demand_posts.push({
      id: crypto.randomUUID(), user_id: ivan.id, title: 'Нужна помощь с основами Python',
      description: 'Хочу разобраться с функциями и списками. Нужны объяснения и небольшой разбор примеров.',
      category: 'Программирование', price_mode: 'negotiable', price: 0,
      status: 'active', is_demo: true, created_at: now, updated_at: now
    });
    if (masha) state.offer_posts.push({
      id: crypto.randomUUID(), user_id: masha.id, title: 'Помогу разговорным английским',
      description: 'Практика разговорной речи и разбор школьных тем. Можно договориться о бесплатной встрече для знакомства.',
      category: 'Языки', price_mode: 'negotiable', price: 0,
      status: 'active', is_demo: true, created_at: now, updated_at: now
    });
    if (ivan || masha) changed = true;
  }
  if (changed) save();
}

ensureCollections();

function grantStartingVrub(userId, reason = 'registration') {
  const user = state.users.find(item => item.id === userId && item.role === 'student');
  if (!user) return false;
  if (!Array.isArray(state.vrub_ledger_entries)) state.vrub_ledger_entries = [];
  if (state.vrub_ledger_entries.some(entry => entry.user_id === userId && entry.event_type === 'initial_grant')) {
    return false;
  }
  const vrub = account(userId, 'vrub');
  const vrubHeld = account(userId, 'vrub_held');
  const hasHistory = state.entries.some(entry => entry.account_id === vrub.id || entry.account_id === vrubHeld.id);
  if ((Number(vrub.balance) || 0) + (Number(vrubHeld.balance) || 0) > 0 || hasHistory) return false;
  const amount = 1000;
  vrub.balance += amount;
  state.vrub_ledger_entries.push({
    id: crypto.randomUUID(), user_id: userId, event_type: 'initial_grant',
    amount, reason, created_at: new Date().toISOString()
  });
  return true;
}

function account(userId, kind) {
  let a = state.accounts.find(x => x.user_id === userId && x.kind === kind);
  if (!a) {
    a = { id: crypto.randomUUID(), user_id: userId, kind, balance: 0 };
    state.accounts.push(a);
  }
  return a;
}

function systemAccount(kind) {
  return state.accounts.find(a => a.user_id === null && a.kind === kind);
}

function balance(userId, kind) {
  return account(userId, kind).balance;
}



function fundingSourceFor(category) {
  const id = 'legacy-' + String(category).toLowerCase();
  let source = state.funding_sources.find(x => x.id === id);
  if (!source) {
    source = {
      id, name: category + ' / unverified source',
      category, verified: false, created_at: new Date().toISOString()
    };
    state.funding_sources.push(source);
  }
  return source.id;
}

function addTokenLedgerEntry(data) {
  state.token_ledger_entries.push({
    id: crypto.randomUUID(),
    tx_id: data.tx_id,
    lot_id: data.lot_id || null,
    source_lot_id: data.source_lot_id || null,
    user_id: data.user_id,
    account_kind: data.account_kind,
    category: data.category,
    origin_category: data.origin_category || data.category,
    funding_source_id: data.funding_source_id || null,
    event_type: data.event_type,
    amount: data.amount,
    actor_id: data.actor_id || null,
    reason: data.reason || null,
    created_at: data.created_at
  });
}

function createTokenLot(userId, accountKind, amount, category, originCategory, sourceId, txId, now, sourceLotId) {
  if (!amount || amount <= 0) return null;
  const source = sourceId || fundingSourceFor(category);
  const lot = {
    id: crypto.randomUUID(),
    user_id: userId,
    account_kind: accountKind,
    category,
    origin_category: originCategory || category,
    funding_source_id: source,
    source_lot_id: sourceLotId || null,
    source_tx_id: txId,
    policy_version: Number(state.settings.token_policy_version || 1),
    available_amount: accountKind === 'available' ? amount : 0,
    locked_amount: accountKind === 'held' ? amount : 0,
    redeemed_amount: 0,
    withdrawal_eligible: false,
    created_at: now
  };
  state.token_lots.push(lot);
  addTokenLedgerEntry({
    tx_id: txId, lot_id: lot.id, user_id: userId, account_kind: accountKind,
    category, origin_category: lot.origin_category, funding_source_id: source,
    event_type: 'credit', amount, created_at: now
  });
  return lot;
}

function tokenCategoryForTransaction(kind) {
  if (kind === 'signup_bonus') return 'Bonus';
  if (kind === 'credit_teacher' || kind === 'credit_admin') return 'School';
  if (kind === 'partner_topup_verified' || kind === 'topup_confirmed') return 'Purchased';
  return 'Earned';
}

function moveTokenLots(userId, fromKind, toKind, amount, txId, now, actorId) {
  const sourceField = fromKind === 'held' ? 'locked_amount' : 'available_amount';
  const targetField = toKind === 'held' ? 'locked_amount' : 'available_amount';
  let remaining = amount;
  const lots = state.token_lots
    .filter(l => l.user_id === userId && (l[sourceField] || 0) > 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const lot of lots) {
    if (remaining <= 0) break;
    const moved = Math.min(remaining, lot[sourceField]);
    lot[sourceField] -= moved;
    lot[targetField] += moved;
    lot.account_kind = toKind;
    addTokenLedgerEntry({
      tx_id: txId, lot_id: lot.id, user_id: userId, account_kind: toKind,
      category: lot.category, origin_category: lot.origin_category,
      funding_source_id: lot.funding_source_id,
      event_type: fromKind === 'available' ? 'lock' : 'unlock',
      amount: moved, actor_id: actorId, created_at: now
    });
    remaining -= moved;
  }
  if (remaining > 0) {
    const legacy = createTokenLot(userId, fromKind, remaining, 'Legacy', 'Legacy', fundingSourceFor('Legacy'), txId, now);
    if (legacy) {
      legacy[sourceField] = 0;
      legacy[targetField] = remaining;
      legacy.account_kind = toKind;
      addTokenLedgerEntry({
        tx_id: txId, lot_id: legacy.id, user_id: userId, account_kind: toKind,
        category: 'Legacy', origin_category: 'Legacy',
        funding_source_id: legacy.funding_source_id,
        event_type: fromKind === 'available' ? 'lock' : 'unlock',
        amount: remaining, actor_id: actorId, created_at: now
      });
    }
  }
}

function consumeTokenLots(userId, accountKind, amount, txId, now, actorId, reason) {
  const field = accountKind === 'held' ? 'locked_amount' : 'available_amount';
  let remaining = amount;
  const fragments = [];
  const lots = state.token_lots
    .filter(l => l.user_id === userId && (l[field] || 0) > 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const lot of lots) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, lot[field]);
    lot[field] -= used;
    fragments.push({
      category: lot.category, origin_category: lot.origin_category,
      funding_source_id: lot.funding_source_id, source_lot_id: lot.id, amount: used
    });
    addTokenLedgerEntry({
      tx_id: txId, lot_id: lot.id, user_id: userId, account_kind: accountKind,
      category: lot.category, origin_category: lot.origin_category,
      funding_source_id: lot.funding_source_id,
      event_type: 'debit', amount: used, actor_id: actorId,
      reason, created_at: now
    });
    remaining -= used;
  }
  if (remaining > 0) {
    const legacy = createTokenLot(userId, accountKind, remaining, 'Legacy', 'Legacy', fundingSourceFor('Legacy'), txId, now);
    if (legacy) {
      legacy[field] = 0;
      fragments.push({
        category: 'Legacy', origin_category: 'Legacy',
        funding_source_id: legacy.funding_source_id, source_lot_id: legacy.id, amount: remaining
      });
      addTokenLedgerEntry({
        tx_id: txId, lot_id: legacy.id, user_id: userId, account_kind: accountKind,
        category: 'Legacy', origin_category: 'Legacy',
        funding_source_id: legacy.funding_source_id,
        event_type: 'debit', amount: remaining, actor_id: actorId,
        reason, created_at: now
      });
    }
  }
  return fragments;
}

function applyTokenLedger(txId, kind, entries, now, actorId) {
  if (state.token_ledger_entries.some(e => e.tx_id === txId)) return;
  const resolved = entries.map(entry => ({
    entry,
    account: state.accounts.find(a => a.id === entry.accountId),
    remaining: entry.amount
  })).filter(x => x.account && x.account.user_id && ['available', 'held'].includes(x.account.kind) && x.remaining !== 0);
  const outgoing = resolved.filter(x => x.remaining < 0);
  const incoming = resolved.filter(x => x.remaining > 0);

  // Same-user available <-> held moves are locks/unlocks, not spend or issuance.
  for (const out of outgoing) {
    if (!out.remaining) continue;
    for (const inc of incoming) {
      if (!inc.remaining || out.account.user_id !== inc.account.user_id) continue;
      if (out.account.kind === inc.account.kind) continue;
      const amount = Math.min(-out.remaining, inc.remaining);
      moveTokenLots(out.account.user_id, out.account.kind, inc.account.kind, amount, txId, now, actorId);
      out.remaining += amount;
      inc.remaining -= amount;
      if (!out.remaining) break;
    }
  }

  // Cross-user transfers preserve provenance while the current holder category becomes Earned.
  for (const out of outgoing) {
    if (!out.remaining) continue;
    for (const inc of incoming) {
      if (!inc.remaining || out.account.user_id === inc.account.user_id) continue;
      const amount = Math.min(-out.remaining, inc.remaining);
      const fragments = consumeTokenLots(out.account.user_id, out.account.kind, amount, txId, now, actorId, kind);
      let remaining = amount;
      for (const fragment of fragments) {
        if (remaining <= 0) break;
        const transferred = Math.min(remaining, fragment.amount);
        createTokenLot(
          inc.account.user_id, inc.account.kind, transferred, 'Earned',
          fragment.origin_category || fragment.category,
          fragment.funding_source_id, txId, now, fragment.source_lot_id
        );
        remaining -= transferred;
      }
      out.remaining += amount;
      inc.remaining -= amount;
      if (!out.remaining) break;
    }
  }

  // Outgoing tokens not transferred to another user are consumed or burned.
  for (const out of outgoing) {
    if (out.remaining < 0) {
      consumeTokenLots(out.account.user_id, out.account.kind, -out.remaining, txId, now, actorId, kind);
      out.remaining = 0;
    }
  }

  // Remaining positive entries are system-funded credits; category is server-derived.
  const category = tokenCategoryForTransaction(kind);
  for (const inc of incoming) {
    if (inc.remaining > 0) {
      createTokenLot(
        inc.account.user_id, inc.account.kind, inc.remaining, category, category,
        fundingSourceFor(category), txId, now
      );
      inc.remaining = 0;
    }
  }
}

function rebuildTokenLedgerFromHistory() {
  if (state.token_ledger_initialized) return;
  state.token_lots = [];
  state.token_ledger_entries = [];
  const transactions = state.transactions.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const tx of transactions) {
    const txEntries = state.entries.filter(e => e.tx_id === tx.id).map(e => ({
      accountId: e.account_id, amount: e.amount, note: e.note
    }));
    if (txEntries.length) applyTokenLedger(tx.id, tx.kind, txEntries, tx.created_at, tx.initiator_id);
  }
  for (const acc of state.accounts.filter(a => a.user_id && ['available', 'held'].includes(a.kind))) {
    const field = acc.kind === 'held' ? 'locked_amount' : 'available_amount';
    const tracked = state.token_lots
      .filter(l => l.user_id === acc.user_id)
      .reduce((sum, lot) => sum + (lot[field] || 0), 0);
    const difference = acc.balance - tracked;
    if (difference > 0) {
      createTokenLot(acc.user_id, acc.kind, difference, 'Legacy', 'Legacy', fundingSourceFor('Legacy'), 'legacy-migration', new Date().toISOString());
    }
  }
  if (!state.token_policy_versions.length) {
    ['Purchased', 'Earned', 'Bonus', 'School'].forEach(category => {
      state.token_policy_versions.push({
        id: crypto.randomUUID(), category, version: 1,
        withdrawal_enabled: false,
        policy: 'Disabled until legal approval and verified funding source.',
        created_at: new Date().toISOString()
      });
    });
  }
  state.token_ledger_initialized = true;
  save();
}

function recordTx(kind, initiator, payload, entries) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('A transaction needs at least two ledger entries');

  const resolved = entries.map(entry => {
    const acc = state.accounts.find(item => item.id === entry.accountId);
    const amount = Number(entry.amount);
    if (!acc) throw new Error('Account not found');
    if (!Number.isSafeInteger(amount)) throw new Error('Invalid transaction amount');
    if (amount === 0) return null;
    return { entry, account: acc, amount };
  }).filter(Boolean);
  if (resolved.length < 2) throw new Error('A transaction needs at least two non-zero ledger entries');

  const projected = new Map();
  for (const item of resolved) {
    projected.set(item.account.id, (projected.get(item.account.id) ?? item.account.balance) + item.amount);
  }
  for (const nextBalance of projected.values()) {
    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) throw new Error('Insufficient funds or invalid balance');
  }
  const totalDelta = resolved.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(totalDelta) || totalDelta !== 0) throw new Error('Unbalanced transaction');

  const snapshot = {
    accounts: JSON.stringify(state.accounts),
    transactions: JSON.stringify(state.transactions),
    entries: JSON.stringify(state.entries),
    token_lots: JSON.stringify(state.token_lots),
    token_ledger_entries: JSON.stringify(state.token_ledger_entries),
    funding_sources: JSON.stringify(state.funding_sources)
  };

  const txId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    state.transactions.push({ id: txId, kind, initiator_id: initiator, payload, created_at: now });
    for (const item of resolved) {
      item.account.balance += item.amount;
      state.entries.push({
        id: crypto.randomUUID(), tx_id: txId, account_id: item.account.id,
        amount: item.amount, note: item.entry.note || null, created_at: now
      });
    }
    applyTokenLedger(txId, kind, resolved.map(item => ({
      accountId: item.account.id, amount: item.amount, note: item.entry.note
    })), now, initiator);
    save();
    return txId;
  } catch (error) {
    state.accounts = JSON.parse(snapshot.accounts);
    state.transactions = JSON.parse(snapshot.transactions);
    state.entries = JSON.parse(snapshot.entries);
    state.token_lots = JSON.parse(snapshot.token_lots);
    state.token_ledger_entries = JSON.parse(snapshot.token_ledger_entries);
    state.funding_sources = JSON.parse(snapshot.funding_sources);
    throw error;
  }
}

rebuildTokenLedgerFromHistory();

module.exports = { state, seedData, save, account, systemAccount, balance, recordTx, rebuildTokenLedgerFromHistory, grantStartingVrub };
