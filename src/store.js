const fs = require('node:fs');
const crypto = require('node:crypto');
const { DATA_FILE } = require('./config');
const { hashPassword } = require('./security');
function seedData() {
  const now = new Date().toISOString();
  const s = {
    users: [], accounts: [], transactions: [], entries: [],
    listings: [], orders: [], auctions: [], bids: [], exchange_orders: []
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
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
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


function recordTx(kind, initiator, payload, entries) {
  const txId = crypto.randomUUID();
  const now = new Date().toISOString();
  for (const e of entries) {
    const acc = state.accounts.find(a => a.id === e.accountId);
    if (!acc) throw new Error('Account not found');
    if (acc.balance + e.amount < 0) throw new Error('Insufficient funds');
  }
  state.transactions.push({ id: txId, kind, initiator_id: initiator, payload, created_at: now });
  for (const e of entries) {
    const acc = state.accounts.find(a => a.id === e.accountId);
    acc.balance += e.amount;
    state.entries.push({
      id: crypto.randomUUID(), tx_id: txId, account_id: e.accountId,
      amount: e.amount, note: e.note || null, created_at: now
    });
  }
  save();
  return txId;
}


module.exports = { state, seedData, save, account, systemAccount, balance, recordTx };
