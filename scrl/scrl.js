// ============================================================
// ScRl — школьная экономика. Один файл, без зависимостей.
// Запуск: node scrl.js
// Все данные хранятся в scrl-data.json (общие для всех пользователей).
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'scrl-data.json');
const SESSION_MAX_AGE = 7 * 24 * 3600;
const WEEKLY_LIMIT = 500;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'scrl-salt-v1').digest('hex');
}

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

const sessions = new Map();

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return out;
}
function getSessionUser(req) {
  const token = parseCookies(req).scrl_session;
  if (!token) return null;
  const uid = sessions.get(token);
  if (!uid) return null;
  return state.users.find(u => u.id === uid) || null;
}
function ageStatus(birth) {
  if (!birth) return 'unknown';
  const age = (Date.now() - new Date(birth).getTime()) / (365.25 * 24 * 3600 * 1000);
  return age < 14 ? 'minor' : age < 18 ? 'teen' : 'adult';
}
function canTrade(user) {
  if (!user || user.role !== 'student') return false;
  return ageStatus(user.birth_date) !== 'minor';
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });
}
function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
function redirect(res, loc) {
  res.writeHead(302, { Location: loc });
  res.end();
}

function msgText(m) {
  return ({
    purchased: 'Заказ создан. Токены заблокированы в escrow.',
    confirmed: 'Заказ подтверждён. Комиссия сожжена.',
    delivered: 'Отмечено как выполнено.',
    created: 'Объявление создано.',
    deleted: 'Объявление удалено.',
    issued: 'Токены начислены.',
    credited: 'Токены начислены.',
    debited: 'Токены списаны.',
    blocked: 'Пользователь заблокирован.',
    unblocked: 'Пользователь разблокирован.',
    bid: 'Ставка принята.',
    auction_created: 'Аукцион создан.',
    auction_finished: 'Аукцион завершён.',
    registered: 'Аккаунт создан. Начислено 100 ScRl.',
    sold: 'Заявка на продажу создана.',
    bought: 'Сделка совершена.',
    cancelled: 'Заявка отменена.'
  })[m] || m;
}
function errText(e) {
  return ({
    insufficient: 'Недостаточно токенов.',
    age: 'Действие недоступно по возрасту или роли.',
    own: 'Нельзя купить своё объявление.',
    bad: 'Некорректный запрос.',
    limit: 'Недельный лимит исчерпан.',
    notfound: 'Не найдено.',
    ended: 'Аукцион завершён.',
    low: 'Ставка слишком низкая.',
    email: 'Email уже занят.',
    fields: 'Заполните все поля.',
    novrub: 'Недостаточно виртуальных рублей.',
    wrong: 'Неверный email или пароль.',
    blocked_acc: 'Аккаунт заблокирован.'
  })[e] || e;
}
function flashBox(url) {
  const msg = url.searchParams.get('msg');
  const err = url.searchParams.get('error');
  if (msg) return `<div class="alert alert-success">${esc(msgText(msg))}</div>`;
  if (err) return `<div class="alert alert-danger">${esc(errText(err))}</div>`;
  return '';
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#FAFAF9;color:#1C1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;min-height:100vh}
a{color:#0F766E;text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:1100px;margin:0 auto;padding:0 20px}
.header{background:#fff;border-bottom:1px solid #E7E5E4;position:sticky;top:0;z-index:10}
.header-inner{display:flex;align-items:center;gap:20px;height:64px;flex-wrap:wrap}
.logo{font-weight:700;color:#0F766E;font-size:20px;display:flex;align-items:center;gap:8px;text-decoration:none!important}
.coin{display:inline-flex;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;font-weight:700;font-size:13px;align-items:center;justify-content:center}
.nav{display:flex;gap:2px;flex:1;flex-wrap:wrap}
.nav a{padding:8px 12px;border-radius:8px;color:#1C1917;font-weight:500;font-size:14px;text-decoration:none!important}
.nav a:hover{background:#CCFBF1}
.header-right{display:flex;align-items:center;gap:12px}
.user-info{display:flex;flex-direction:column;font-size:13px;text-align:right}
.user-info small{color:#78716C;font-size:11px;text-transform:uppercase}
main{padding:24px 0 60px}
h1{font-size:26px;margin-bottom:16px}
h2{font-size:18px;margin-bottom:12px}
h3{font-size:16px}
.card{background:#fff;border:1px solid #E7E5E4;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card.balance{background:#FEF3C7;border-color:#FDE68A}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 16px;border-radius:8px;font-weight:500;font-size:14px;border:none;cursor:pointer;text-decoration:none!important;transition:background .15s;font-family:inherit}
.btn-primary{background:#0F766E;color:#fff}
.btn-primary:hover{background:#115E59}
.btn-accent{background:#F59E0B;color:#fff}
.btn-accent:hover{background:#D97706}
.btn-ghost{background:transparent;color:#1C1917;border:1px solid #E7E5E4}
.btn-ghost:hover{background:#CCFBF1}
.btn-danger{background:#DC2626;color:#fff}
.btn-danger:hover{background:#B91C1C}
.btn-sm{padding:4px 10px;font-size:12px}
.btn-block{width:100%;margin-top:8px}
input,select,textarea{width:100%;padding:8px 12px;border:1px solid #E7E5E4;border-radius:8px;font-family:inherit;font-size:14px;margin-bottom:12px;background:#fff}
input:focus,select:focus,textarea:focus{outline:2px solid #0F766E;outline-offset:-1px;border-color:transparent}
label{display:block;margin-bottom:4px;font-weight:500;font-size:13px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.badge-primary-soft{background:#CCFBF1;color:#0F766E}
.badge-accent{background:#FEF3C7;color:#B45309}
.badge-success{background:#DCFCE7;color:#15803D}
.badge-danger{background:#FEE2E2;color:#B91C1C}
.badge-muted{background:#F5F5F4;color:#78716C}
.muted{color:#78716C}
.small{font-size:12px}
.accent{color:#D97706}
.row-between{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.mt-1{margin-top:8px}.mt-2{margin-top:16px}
.alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
.alert-info{background:#DBEAFE;color:#1E40AF}
.alert-danger{background:#FEE2E2;color:#B91C1C}
.alert-success{background:#DCFCE7;color:#15803D}
hr{border:none;border-top:1px solid #E7E5E4;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px;text-align:left;border-bottom:1px solid #E7E5E4}
th{color:#78716C;font-weight:500;font-size:12px;text-transform:uppercase}
.metric{text-align:center}
.metric .value{font-size:28px;font-weight:700;margin-top:4px}
.text-center{text-align:center}
.progress{height:8px;background:#CCFBF1;border-radius:999px;overflow:hidden;margin-top:8px}
.progress-bar{height:100%;background:#0F766E;transition:width .3s}
@media (max-width:720px){
  .nav{width:100%;order:3;padding-bottom:8px;overflow-x:auto}
  .header-inner{height:auto;padding:10px 0}
  .user-info{display:none}
}
`;

function autoRefreshScript() {
  return `<script>
(function(){
  let last = Date.now();
  ['click','keydown','input','scroll','mousemove'].forEach(ev =>
    document.addEventListener(ev, () => { last = Date.now(); }, { passive: true })
  );
  setInterval(() => {
    if (Date.now() - last > 60000) {
      if (!document.querySelector('input:focus,textarea:focus,select:focus')) {
        location.reload();
      } else { last = Date.now(); }
    }
  }, 10000);
})();
</script>`;
}

function layout(title, user, content) {
  const nav = !user ? '' : `<nav class="nav">
    ${user.role === 'student' ? `
      <a href="/app">Главная</a><a href="/market">Маркет</a><a href="/orders">Заказы</a>
      <a href="/auctions">Аукционы</a><a href="/exchange">Биржа</a><a href="/wallet">Кошелёк</a>
    ` : ''}
    ${user.role === 'teacher' ? `<a href="/teacher">Кабинет</a>` : ''}
    ${user.role === 'admin' ? `<a href="/admin">Монитор</a><a href="/admin/users">Пользователи</a>` : ''}
  </nav>`;
  const badge = user && user.role === 'student'
    ? `<span class="badge badge-accent">🪙 ${balance(user.id, 'available')} ScRl</span>` : '';
  const right = user ? `<div class="header-right">${badge}
    <div class="user-info"><b>${esc(user.full_name)}</b><small>${user.role}</small></div>
    <a href="/logout" class="btn btn-ghost btn-sm">Выйти</a></div>` : '';
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ScRl</title><style>${CSS}</style></head>
<body><header class="header"><div class="container header-inner">
<a href="/" class="logo"><span class="coin">S</span>ScRl</a>${nav}${right}
</div></header><main class="container">${content}</main>${autoRefreshScript()}</body></html>`;
}

function pageLogin(res, user, url) {
  if (user) return redirect(res, '/');
  const quick = [
    ['ivan@scrl.demo', 'Иван (ученик)'],
    ['masha@scrl.demo', 'Мария (ученик)'],
    ['teacher@scrl.demo', 'Учитель'],
    ['admin@scrl.demo', 'Админ']
  ].map(([e, l]) => `<form method="POST" action="/login"><input type="hidden" name="email" value="${e}"><input type="hidden" name="password" value="password123"><button class="btn btn-ghost btn-sm btn-block" style="margin:0">${l}</button></form>`).join('');
  sendHtml(res, layout('Вход', null, `
    <div class="card" style="max-width:440px;margin:40px auto">
      <h1>Вход в ScRl</h1>
      <p class="muted" style="margin-bottom:16px">Школьная экономика</p>
      ${flashBox(url)}
      <form method="POST" action="/login">
        <label>Email</label>
        <input name="email" type="email" required placeholder="ivan@scrl.demo">
        <label>Пароль</label>
        <input name="password" type="password" required placeholder="password123">
        <button type="submit" class="btn btn-primary btn-block">Войти</button>
      </form>
      <p class="text-center mt-2">Нет аккаунта? <a href="/register">Зарегистрироваться</a></p>
      <hr>
      <p class="muted small">Быстрый вход (пароль <code>password123</code>):</p>
      <div class="grid-2 mt-1">${quick}</div>
    </div>`));
}

function doLogin(req, res, params) {
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const user = state.users.find(u => u.email === email);
  if (!user || user.password_hash !== hashPassword(password)) return redirect(res, '/login?error=wrong');
  if (user.is_blocked) return redirect(res, '/login?error=blocked_acc');
  const token = crypto.randomUUID();
  sessions.set(token, user.id);
  const loc = user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/app';
  res.writeHead(302, {
    Location: loc,
    'Set-Cookie': `scrl_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}`
  });
  res.end();
}

function pageRegister(res, user, url) {
  if (user) return redirect(res, '/');
  sendHtml(res, layout('Регистрация', null, `
    <div class="card" style="max-width:440px;margin:40px auto">
      <h1>Регистрация ученика</h1>
      ${flashBox(url)}
      <form method="POST" action="/register">
        <label>ФИО</label><input name="full_name" required>
        <label>Email</label><input name="email" type="email" required>
        <label>Пароль (мин. 6)</label><input name="password" type="password" required minlength="6">
        <label>Класс</label><input name="class_name" required placeholder="8А">
        <label>Дата рождения</label><input name="birth_date" type="date" required>
        <button type="submit" class="btn btn-primary btn-block">Создать аккаунт</button>
      </form>
      <p class="text-center mt-2">Уже есть аккаунт? <a href="/login">Войти</a></p>
      <p class="muted small mt-2">При регистрации начисляется 100 ScRl. До 14 лет торговля недоступна.</p>
    </div>`));
}

function doRegister(req, res, params) {
  const full_name = (params.get('full_name') || '').trim();
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const class_name = (params.get('class_name') || '').trim();
  const birth_date = params.get('birth_date') || '';
  if (!full_name || !email || !password || !class_name || !birth_date) return redirect(res, '/register?error=fields');
  if (state.users.find(u => u.email === email)) return redirect(res, '/register?error=email');

  const id = crypto.randomUUID();
  state.users.push({
    id, email, password_hash: hashPassword(password), role: 'student',
    full_name, class_name, birth_date, is_blocked: false,
    created_at: new Date().toISOString()
  });
  account(id, 'available');
  account(id, 'held');
  account(id, 'vrub').balance = 1000;
  save();

  recordTx('signup_bonus', id, { amount: 100 }, [
    { accountId: systemAccount('reserve').id, amount: -100 },
    { accountId: account(id, 'available').id, amount: 100 }
  ]);

  const token = crypto.randomUUID();
  sessions.set(token, id);
  res.writeHead(302, {
    Location: '/app?msg=registered',
    'Set-Cookie': `scrl_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}`
  });
  res.end();
}

function doLogout(req, res) {
  const token = parseCookies(req).scrl_session;
  if (token) sessions.delete(token);
  res.writeHead(302, { Location: '/login', 'Set-Cookie': 'scrl_session=; HttpOnly; Path=/; Max-Age=0' });
  res.end();
}

function pageApp(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const av = balance(user.id, 'available');
  const hd = balance(user.id, 'held');
  const vr = balance(user.id, 'vrub');
  const recent = state.entries
    .filter(e => {
      const acc = state.accounts.find(a => a.id === e.account_id);
      return acc && acc.user_id === user.id && acc.kind === 'available' && e.amount !== 0;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8)
    .map(e => {
      const tx = state.transactions.find(t => t.id === e.tx_id);
      return `<li class="row-between" style="padding:8px 0;border-bottom:1px solid #E7E5E4;font-size:14px">
        <span class="muted">${esc(tx ? tx.kind : '')}</span>
        <span class="${e.amount > 0 ? 'badge badge-success' : 'badge badge-danger'}">${e.amount > 0 ? '+' : ''}${e.amount}</span></li>`;
    }).join('');
  const activeOrders = state.orders
    .filter(o => (o.buyer_id === user.id || o.seller_id === user.id) && ['awaiting_delivery', 'awaiting_confirmation'].includes(o.status))
    .slice(0, 5)
    .map(o => `<li class="row-between" style="padding:6px 0;border-bottom:1px solid #E7E5E4;font-size:14px">
      <span>${o.buyer_id === user.id ? 'Покупка' : 'Продажа'}</span>
      <span class="muted">${o.price} ScRl</span>
      <span class="badge badge-muted">${o.status}</span></li>`).join('');
  const tradeable = canTrade(user);

  sendHtml(res, layout('Главная', user, `
    ${flashBox(url)}
    <div class="card balance">
      <div class="muted small">Доступно</div>
      <div style="font-size:36px;font-weight:700;margin:4px 0">🪙 ${av} ScRl</div>
      <div class="small">Заблокировано: ${hd} · Вирт. рубли: ${vr}</div>
    </div>
    ${!tradeable ? `<div class="alert alert-info">Покупки и аукционы доступны с 14 лет. Вы можете получать токены и просматривать маркет.</div>` : ''}
    <div class="grid grid-3">
      <a href="/market" class="card" style="text-decoration:none;color:inherit"><b>Маркетплейс</b><div class="muted small">Услуги учеников</div></a>
      <a href="/auctions" class="card" style="text-decoration:none;color:inherit"><b>Аукционы</b><div class="muted small">Призы за токены</div></a>
      <a href="/exchange" class="card" style="text-decoration:none;color:inherit"><b>Биржа</b><div class="muted small">ScRl ↔ вирт. рубли</div></a>
    </div>
    <div class="grid grid-2 mt-2">
      <div class="card"><h2>Последние операции</h2>${recent ? `<ul style="list-style:none">${recent}</ul>` : '<p class="muted small">Пока пусто</p>'}</div>
      <div class="card"><h2>Активные заказы</h2>${activeOrders ? `<ul style="list-style:none">${activeOrders}</ul>` : '<p class="muted small">Нет заказов</p>'}<a href="/orders" class="mt-1">Все заказы →</a></div>
    </div>`));
}

function pageWallet(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const rows = state.entries
    .filter(e => {
      const acc = state.accounts.find(a => a.id === e.account_id);
      return acc && acc.user_id === user.id && acc.kind === 'available';
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100)
    .map(e => {
      const tx = state.transactions.find(t => t.id === e.tx_id);
      return `<tr><td class="muted small">${new Date(e.created_at).toLocaleString('ru-RU')}</td>
        <td>${esc(tx ? tx.kind : '')}</td><td class="muted">${esc(e.note || '')}</td>
        <td style="text-align:right" class="${e.amount > 0 ? 'badge badge-success' : 'badge badge-danger'}">${e.amount > 0 ? '+' : ''}${e.amount}</td></tr>`;
    }).join('');
  sendHtml(res, layout('Кошелёк', user, `
    ${flashBox(url)}
    <h1>Кошелёк</h1>
    <div class="grid grid-4">
      <div class="card"><div class="muted small">Доступно</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'available')} ScRl</div></div>
      <div class="card"><div class="muted small">Заблокировано</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'held')} ScRl</div></div>
      <div class="card"><div class="muted small">Вирт. рубли</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'vrub')}</div></div>
      <div class="card"><div class="muted small">Статус</div><div style="font-size:22px;font-weight:700">${ageStatus(user.birth_date)}</div></div>
    </div>
    <div class="card"><h2>История операций</h2>
      ${rows ? `<table><thead><tr><th>Дата</th><th>Тип</th><th>Комментарий</th><th style="text-align:right">Сумма</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Пока пусто</p>'}
    </div>`));
}

function pageMarket(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const tradeable = canTrade(user);
  const othersListings = state.listings.filter(l => l.status === 'active' && l.seller_id !== user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const myListings = state.listings.filter(l => l.seller_id === user.id && l.status === 'active')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const items = othersListings.map(l => {
    const seller = state.users.find(u => u.id === l.seller_id);
    return `<div class="card">
      <div class="row-between"><b>${esc(l.title)}</b><span class="badge badge-primary-soft">${esc(l.category)}</span></div>
      <div class="muted small mt-1">${esc(seller ? seller.full_name : '')} · ${esc(seller && seller.class_name || '')}</div>
      <p class="mt-1">${esc(l.description)}</p>
      <div class="row-between mt-1"><b class="accent">🪙 ${l.price}</b>
        ${tradeable ? `<form method="POST" action="/market/buy"><input type="hidden" name="listing_id" value="${l.id}"><button class="btn btn-accent btn-sm">Купить</button></form>` : `<span class="muted small">14+</span>`}
      </div></div>`;
  }).join('');

  const mine = myListings.map(l => `<div class="card">
    <div class="row-between">
      <div><b>${esc(l.title)}</b><div class="muted small">${esc(l.category)} · ${l.price} ScRl</div></div>
      <form method="POST" action="/market/delete"><input type="hidden" name="listing_id" value="${l.id}"><button class="btn btn-ghost btn-sm">Удалить</button></form>
    </div></div>`).join('');

  const form = tradeable ? `<div class="card"><h2>Создать объявление</h2>
    <form method="POST" action="/market/create">
      <label>Название</label><input name="title" required maxlength="80">
      <label>Категория</label><select name="category">
        <option>Репетиторство</option><option>Помощь с предметом</option><option>Дизайн</option>
        <option>Рисование</option><option>Языки</option><option>Поделки</option><option>Другое</option>
      </select>
      <label>Описание</label><textarea name="description" required rows="2" maxlength="600"></textarea>
      <label>Цена, ScRl</label><input name="price" type="number" min="1" required>
      <button type="submit" class="btn btn-primary">Опубликовать</button>
    </form></div>` : '';

  sendHtml(res, layout('Маркет', user, `
    ${flashBox(url)}
    <h1>Маркетплейс услуг</h1>
    ${form}
    ${mine ? `<div class="card"><h2>Мои объявления</h2>${mine}</div>` : ''}
    <div class="grid grid-3">${items || '<p class="muted">Пока нет объявлений — станьте первым продавцом.</p>'}</div>`));
}

function handleCreateListing(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/market?error=age');
  const title = (params.get('title') || '').trim();
  const category = params.get('category') || 'Другое';
  const description = (params.get('description') || '').trim();
  const price = parseInt(params.get('price') || '0', 10);
  if (!title || !description || !price || price < 1) return redirect(res, '/market?error=fields');
  state.listings.push({
    id: crypto.randomUUID(), seller_id: user.id, title, category, description, price,
    status: 'active', created_at: new Date().toISOString()
  });
  save();
  redirect(res, '/market?msg=created');
}

function handleDeleteListing(res, user, params) {
  const listing = state.listings.find(l => l.id === params.get('listing_id'));
  if (!listing || listing.seller_id !== user.id || listing.status !== 'active') return redirect(res, '/market?error=bad');
  listing.status = 'removed';
  save();
  redirect(res, '/market?msg=deleted');
}

function handleBuyListing(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/market?error=age');
  const listingId = params.get('listing_id');
  const listing = state.listings.find(l => l.id === listingId && l.status === 'active');
  if (!listing) return redirect(res, '/market?error=notfound');
  if (listing.seller_id === user.id) return redirect(res, '/market?error=own');
  if (balance(user.id, 'available') < listing.price) return redirect(res, '/market?error=insufficient');

  const orderId = crypto.randomUUID();
  recordTx('order_hold', user.id, { orderId, listingId, amount: listing.price }, [
    { accountId: account(user.id, 'available').id, amount: -listing.price, note: 'Покупка' },
    { accountId: account(user.id, 'held').id, amount: listing.price, note: 'Escrow' }
  ]);
  state.orders.push({
    id: orderId, listing_id: listingId, buyer_id: user.id, seller_id: listing.seller_id,
    price: listing.price, commission: Math.floor(listing.price * 0.1),
    status: 'awaiting_delivery', created_at: new Date().toISOString()
  });
  listing.status = 'in_progress';
  save();
  redirect(res, '/orders?msg=purchased');
}

function pageOrders(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const statusLabel = s => ({
    awaiting_delivery: 'Ожидает выполнения',
    awaiting_confirmation: 'Ожидает подтверждения',
    completed: 'Выполнен', disputed: 'Спор', refunded: 'Возврат'
  }[s] || s);
  const statusBadge = s => ({
    awaiting_delivery: 'badge-muted', awaiting_confirmation: 'badge-accent',
    completed: 'badge-success', disputed: 'badge-danger'
  }[s] || 'badge-muted');
  const cardFor = (o, kind) => {
    const listing = state.listings.find(l => l.id === o.listing_id);
    const other = state.users.find(u => u.id === (kind === 'buyer' ? o.seller_id : o.buyer_id));
    let actions = '';
    if (kind === 'buyer' && o.status === 'awaiting_confirmation')
      actions = `<form method="POST" action="/orders/confirm"><input type="hidden" name="order_id" value="${o.id}"><button class="btn btn-primary btn-sm">Подтвердить выполнение</button></form>`;
    if (kind === 'seller' && o.status === 'awaiting_delivery')
      actions = `<form method="POST" action="/orders/deliver"><input type="hidden" name="order_id" value="${o.id}"><button class="btn btn-primary btn-sm">Я выполнил</button></form>`;
    return `<div class="card">
      <div class="row-between">
        <div><b>${esc(listing ? listing.title : '—')}</b>
          <div class="muted small">${kind === 'buyer' ? 'Продавец' : 'Покупатель'}: ${esc(other ? other.full_name : '')}</div></div>
        <div style="text-align:right"><div class="accent"><b>🪙 ${o.price}</b></div>
          <span class="badge ${statusBadge(o.status)}">${statusLabel(o.status)}</span></div>
      </div>
      ${actions ? `<div class="mt-2">${actions}</div>` : ''}
    </div>`;
  };
  const buyer = state.orders.filter(o => o.buyer_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const seller = state.orders.filter(o => o.seller_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

  sendHtml(res, layout('Заказы', user, `
    ${flashBox(url)}
    <h1>Мои заказы</h1>
    <h2>Я покупаю</h2>
    ${buyer.length ? buyer.map(o => cardFor(o, 'buyer')).join('') : '<p class="muted small">Нет покупок</p>'}
    <h2 class="mt-2">Я продаю</h2>
    ${seller.length ? seller.map(o => cardFor(o, 'seller')).join('') : '<p class="muted small">Нет заказов</p>'}`));
}

function handleDeliver(res, user, params) {
  const orderId = params.get('order_id');
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.seller_id !== user.id || order.status !== 'awaiting_delivery') return redirect(res, '/orders?error=bad');
  order.status = 'awaiting_confirmation';
  order.delivered_at = new Date().toISOString();
  save();
  redirect(res, '/orders?msg=delivered');
}

function handleConfirm(res, user, params) {
  const orderId = params.get('order_id');
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.buyer_id !== user.id || order.status !== 'awaiting_confirmation') return redirect(res, '/orders?error=bad');
  const commission = Math.floor(order.price * 0.1);
  const sellerAmount = order.price - commission;
  recordTx('order_settle', user.id, { orderId, price: order.price, commission }, [
    { accountId: account(order.buyer_id, 'held').id, amount: -order.price, note: 'Escrow' },
    { accountId: account(order.seller_id, 'available').id, amount: sellerAmount, note: 'Выплата' },
    { accountId: systemAccount('burn').id, amount: commission, note: 'Комиссия 10%' }
  ]);
  order.status = 'completed';
  order.confirmed_at = new Date().toISOString();
  const listing = state.listings.find(l => l.id === order.listing_id);
  if (listing) listing.status = 'completed';
  save();
  redirect(res, '/orders?msg=confirmed');
}

function autoFinishAuctions() {
  let changed = false;
  for (const a of state.auctions) {
    if (a.status === 'active' && new Date(a.ends_at).getTime() < Date.now()) {
      if (a.current_winner_id && a.current_bid > 0) {
        try {
          recordTx('auction_burn', a.current_winner_id, { auctionId: a.id, amount: a.current_bid }, [
            { accountId: account(a.current_winner_id, 'held').id, amount: -a.current_bid, note: 'Победная ставка' },
            { accountId: systemAccount('burn').id, amount: a.current_bid, note: 'Аукцион' }
          ]);
          const wonBid = state.bids.find(b => b.auction_id === a.id && b.bidder_id === a.current_winner_id && b.status === 'active');
          if (wonBid) wonBid.status = 'won';
        } catch (e) { console.error('auction finish:', e.message); }
      }
      a.status = 'finished';
      changed = true;
    }
  }
  if (changed) save();
}

function pageAuctions(res, user, url) {
  autoFinishAuctions();
  const canCreate = user.role === 'teacher' || user.role === 'admin';
  const tradeable = canTrade(user);
  const items = state.auctions.filter(a => a.status === 'active')
    .sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at))
    .map(a => {
      const leader = state.users.find(u => u.id === a.current_winner_id);
      const minNext = a.current_bid > 0 ? a.current_bid + a.min_step : a.start_price;
      const ended = new Date(a.ends_at).getTime() < Date.now();
      const canBid = tradeable && !ended;
      const canFinish = (user.role === 'admin' || user.role === 'teacher') && !ended;
      return `<div class="card">
        <div class="row-between">
          <div><h3>${esc(a.title)}</h3><div class="muted small">Приз: ${esc(a.prize)}</div>
            <div class="small mt-1">Лидер: <b>${esc(leader ? leader.full_name : '—')}</b> · ставка ${a.current_bid} · шаг ${a.min_step}</div></div>
          <div style="text-align:right"><div class="muted small">до конца</div><div>${new Date(a.ends_at).toLocaleString('ru-RU')}</div></div>
        </div>
        ${canBid ? `<form method="POST" action="/auctions/bid" class="row mt-2"><input type="hidden" name="auction_id" value="${a.id}"><input name="amount" type="number" min="${minNext}" required placeholder="мин. ${minNext}" style="flex:1;max-width:160px;margin:0"><button class="btn btn-accent btn-sm">Сделать ставку</button></form>` : ''}
        ${canFinish ? `<form method="POST" action="/auctions/finish" class="mt-2"><input type="hidden" name="auction_id" value="${a.id}"><button class="btn btn-ghost btn-sm">Завершить сейчас (демо)</button></form>` : ''}
      </div>`;
    }).join('');
  const createForm = canCreate ? `<div class="card"><h2>Создать аукцион</h2>
    <form method="POST" action="/auctions/create">
      <div class="grid grid-2">
        <div><label>Название</label><input name="title" required></div>
        <div><label>Приз</label><input name="prize" required placeholder="Пицца"></div>
      </div>
      <div class="grid grid-2">
        <div><label>Стартовая цена</label><input name="start_price" type="number" min="1" required></div>
        <div><label>Шаг</label><input name="min_step" type="number" min="1" value="10"></div>
      </div>
      <label>Длительность (минуты)</label><input name="duration_min" type="number" min="1" value="5">
      <button class="btn btn-primary">Создать</button>
    </form></div>` : '';
  sendHtml(res, layout('Аукционы', user, `
    ${flashBox(url)}
    <h1>Аукционы</h1>
    ${createForm}
    ${items || '<p class="muted">Активных аукционов нет</p>'}`));
}

function handleCreateAuction(res, user, params) {
  if (user.role !== 'teacher' && user.role !== 'admin') return redirect(res, '/auctions?error=bad');
  const title = (params.get('title') || '').trim();
  const prize = (params.get('prize') || '').trim();
  const start = parseInt(params.get('start_price') || '0', 10);
  const step = parseInt(params.get('min_step') || '10', 10);
  const minutes = parseInt(params.get('duration_min') || '5', 10);
  if (!title || !prize || !start || start < 1) return redirect(res, '/auctions?error=fields');
  state.auctions.push({
    id: crypto.randomUUID(), title, prize, start_price: start, min_step: step || 10,
    current_bid: 0, current_winner_id: null,
    ends_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    status: 'active', created_by: user.id, created_at: new Date().toISOString()
  });
  save();
  redirect(res, '/auctions?msg=auction_created');
}

function handleBid(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/auctions?error=age');
  const auctionId = params.get('auction_id');
  const amount = parseInt(params.get('amount') || '0', 10);
  const a = state.auctions.find(x => x.id === auctionId && x.status === 'active');
  if (!a) return redirect(res, '/auctions?error=notfound');
  if (new Date(a.ends_at).getTime() < Date.now()) return redirect(res, '/auctions?error=ended');
  const minNext = a.current_bid > 0 ? a.current_bid + a.min_step : a.start_price;
  if (amount < minNext) return redirect(res, '/auctions?error=low');
  if (balance(user.id, 'available') < amount) return redirect(res, '/auctions?error=insufficient');

  if (a.current_winner_id && a.current_winner_id !== user.id) {
    try {
      recordTx('auction_refund', a.current_winner_id, { auctionId, amount: a.current_bid }, [
        { accountId: account(a.current_winner_id, 'held').id, amount: -a.current_bid, note: 'Возврат' },
        { accountId: account(a.current_winner_id, 'available').id, amount: a.current_bid, note: 'Возврат' }
      ]);
      const prev = state.bids.find(b => b.auction_id === auctionId && b.bidder_id === a.current_winner_id && b.status === 'active');
      if (prev) prev.status = 'outbid';
    } catch (e) { console.error('refund:', e.message); }
  }
  if (a.current_winner_id === user.id && a.current_bid > 0) {
    try {
      recordTx('auction_refund', user.id, { auctionId, amount: a.current_bid }, [
        { accountId: account(user.id, 'held').id, amount: -a.current_bid, note: 'Возврат' },
        { accountId: account(user.id, 'available').id, amount: a.current_bid, note: 'Возврат' }
      ]);
    } catch (e) {}
  }
  recordTx('auction_hold', user.id, { auctionId, amount }, [
    { accountId: account(user.id, 'available').id, amount: -amount, note: 'Ставка' },
    { accountId: account(user.id, 'held').id, amount, note: 'Ставка в аукционе' }
  ]);
  state.bids.push({
    id: crypto.randomUUID(), auction_id: auctionId, bidder_id: user.id,
    amount, status: 'active', created_at: new Date().toISOString()
  });
  a.current_bid = amount;
  a.current_winner_id = user.id;
  save();
  redirect(res, '/auctions?msg=bid');
}

function handleFinishAuction(res, user, params) {
  if (user.role !== 'admin' && user.role !== 'teacher') return redirect(res, '/auctions?error=bad');
  const auctionId = params.get('auction_id');
  const a = state.auctions.find(x => x.id === auctionId && x.status === 'active');
  if (!a) return redirect(res, '/auctions?error=notfound');
  if (a.current_winner_id && a.current_bid > 0) {
    try {
      recordTx('auction_burn', a.current_winner_id, { auctionId, amount: a.current_bid }, [
        { accountId: account(a.current_winner_id, 'held').id, amount: -a.current_bid, note: 'Победная ставка' },
        { accountId: systemAccount('burn').id, amount: a.current_bid, note: 'Аукцион' }
      ]);
      const wonBid = state.bids.find(b => b.auction_id === auctionId && b.bidder_id === a.current_winner_id && b.status === 'active');
      if (wonBid) wonBid.status = 'won';
    } catch (e) { console.error('finish:', e.message); }
  }
  a.status = 'finished';
  save();
  redirect(res, '/auctions?msg=auction_finished');
}

function pageExchange(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const tradeable = canTrade(user);
  const offers = state.exchange_orders.filter(e => e.status === 'active').sort((a, b) => a.price_per_unit - b.price_per_unit);
  const myOrders = state.exchange_orders.filter(e => e.seller_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
  const rows = offers.map(o => {
    const seller = state.users.find(u => u.id === o.seller_id);
    return `<tr><td>${esc(seller ? seller.full_name : '')}</td><td>${o.amount} ScRl</td>
      <td>${o.price_per_unit.toFixed(2)} vrub</td>
      <td style="text-align:right">${tradeable && o.seller_id !== user.id ? `<form method="POST" action="/exchange/buy" style="display:inline"><input type="hidden" name="order_id" value="${o.id}"><button class="btn btn-accent btn-sm">Купить</button></form>` : ''}</td></tr>`;
  }).join('');
  const myRows = myOrders.map(o => `<li class="row-between" style="padding:6px 0;border-bottom:1px solid #E7E5E4;font-size:14px">
    <span>${o.amount} ScRl @ ${o.price_per_unit.toFixed(2)}</span>
    <span class="badge badge-muted">${o.status}</span>
    ${o.status === 'active' ? `<form method="POST" action="/exchange/cancel"><input type="hidden" name="order_id" value="${o.id}"><button class="btn btn-ghost btn-sm">Отменить</button></form>` : ''}</li>`).join('');
  sendHtml(res, layout('Биржа', user, `
    ${flashBox(url)}
    <h1>P2P-биржа (симуляция)</h1>
    <div class="card"><div class="small">Вирт. рубли: <b>${balance(user.id, 'vrub')}</b> · Доступно ScRl: <b>${balance(user.id, 'available')}</b></div></div>
    ${tradeable ? `<div class="card"><h2>Выставить ScRl на продажу</h2>
      <form method="POST" action="/exchange/sell">
        <div class="grid grid-2">
          <div><label>Сколько ScRl</label><input name="amount" type="number" min="1" required></div>
          <div><label>Цена за 1 ScRl (vrub)</label><input name="price" type="number" step="0.01" min="0.01" required value="1.00"></div>
        </div>
        <button class="btn btn-primary">Выставить</button>
      </form></div>` : '<div class="alert alert-info">Торговля доступна с 14 лет.</div>'}
    <div class="card"><h2>Предложения продавцов</h2>
      ${rows ? `<table><thead><tr><th>Продавец</th><th>Кол-во</th><th>Цена</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">Нет предложений</p>'}
    </div>
    <div class="card"><h2>Мои заявки</h2>${myRows ? `<ul style="list-style:none">${myRows}</ul>` : '<p class="muted small">Нет заявок</p>'}</div>`));
}

function handleExchangeSell(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/exchange?error=age');
  const amount = parseInt(params.get('amount') || '0', 10);
  const price = parseFloat(params.get('price') || '0');
  if (!amount || amount < 1 || !price || price <= 0) return redirect(res, '/exchange?error=fields');
  if (balance(user.id, 'available') < amount) return redirect(res, '/exchange?error=insufficient');
  const orderId = crypto.randomUUID();
  recordTx('exchange_hold', user.id, { orderId, amount, price }, [
    { accountId: account(user.id, 'available').id, amount: -amount, note: 'Заявка на продажу' },
    { accountId: account(user.id, 'held').id, amount, note: 'Заявка на продажу' }
  ]);
  state.exchange_orders.push({
    id: orderId, seller_id: user.id, amount, price_per_unit: price,
    status: 'active', created_at: new Date().toISOString()
  });
  save();
  redirect(res, '/exchange?msg=sold');
}

function handleExchangeCancel(res, user, params) {
  const orderId = params.get('order_id');
  const o = state.exchange_orders.find(x => x.id === orderId && x.status === 'active');
  if (!o || o.seller_id !== user.id) return redirect(res, '/exchange?error=bad');
  recordTx('exchange_cancel', user.id, { orderId, amount: o.amount }, [
    { accountId: account(user.id, 'held').id, amount: -o.amount, note: 'Отмена' },
    { accountId: account(user.id, 'available').id, amount: o.amount, note: 'Отмена' }
  ]);
  o.status = 'cancelled';
  save();
  redirect(res, '/exchange?msg=cancelled');
}

function handleExchangeBuy(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/exchange?error=age');
  const orderId = params.get('order_id');
  const o = state.exchange_orders.find(x => x.id === orderId && x.status === 'active');
  if (!o) return redirect(res, '/exchange?error=notfound');
  if (o.seller_id === user.id) return redirect(res, '/exchange?error=own');
  const cost = Math.round(o.amount * o.price_per_unit);
  if (balance(user.id, 'vrub') < cost) return redirect(res, '/exchange?error=novrub');
  const commission = Math.max(1, Math.floor(o.amount * 0.01));
  const buyerGets = o.amount - commission;
  recordTx('exchange_trade', user.id, { orderId, amount: o.amount, price: o.price_per_unit, cost, commission }, [
    { accountId: account(o.seller_id, 'held').id, amount: -o.amount, note: 'Продажа ScRl' },
    { accountId: account(user.id, 'available').id, amount: buyerGets, note: 'Покупка ScRl' },
    { accountId: systemAccount('burn').id, amount: commission, note: 'Комиссия 1%' },
    { accountId: account(user.id, 'vrub').id, amount: -cost, note: 'Оплата' },
    { accountId: account(o.seller_id, 'vrub').id, amount: cost, note: 'Выплата' }
  ]);
  o.status = 'filled';
  save();
  redirect(res, '/exchange?msg=bought');
}

function pageTeacher(res, user, url) {
  if (user.role !== 'teacher') return redirect(res, '/');
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const issued = state.transactions
    .filter(t => t.kind === 'credit_teacher' && t.initiator_id === user.id && t.created_at > weekAgo)
    .reduce((s, t) => s + (t.payload.amount || 0), 0);
  const remaining = WEEKLY_LIMIT - issued;
  const students = state.users.filter(u => u.role === 'student' && u.class_name === user.class_name);
  const opts = students.map(s => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('');
  const rows = students.map(s => `<tr><td>${esc(s.full_name)}</td><td>${esc(s.class_name)}</td>
    <td style="text-align:right"><b>${balance(s.id, 'available')}</b> ScRl</td></tr>`).join('');
  sendHtml(res, layout('Учитель', user, `
    ${flashBox(url)}
    <h1>Кабинет учителя</h1>
    <div class="card">
      <div class="row-between"><span>Недельный лимит</span><span>Осталось <b>${remaining}</b> из ${WEEKLY_LIMIT}</span></div>
      <div class="progress"><div class="progress-bar" style="width:${Math.max(0, (remaining / WEEKLY_LIMIT) * 100)}%"></div></div>
    </div>
    <div class="card"><h2>Начислить токены</h2>
      <form method="POST" action="/teacher/issue">
        <div class="grid grid-2">
          <div><label>Ученик</label><select name="user_id" required><option value="">— выберите —</option>${opts}</select></div>
          <div><label>Сумма, ScRl</label><input name="amount" type="number" min="1" max="${remaining}" required></div>
        </div>
        <label>Причина</label><select name="reason">
          <option>Помощь другим</option><option>Академические достижения</option>
          <option>Проект</option><option>Инициатива</option><option>Другое</option>
        </select>
        <button class="btn btn-primary">Начислить</button>
      </form>
    </div>
    <div class="card"><h2>Ученики класса ${esc(user.class_name || '')}</h2>
      ${rows ? `<table><thead><tr><th>Ученик</th><th>Класс</th><th style="text-align:right">Баланс</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">Нет учеников в вашем классе</p>'}
    </div>`));
}

function handleIssue(res, user, params) {
  if (user.role !== 'teacher') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = parseInt(params.get('amount') || '0', 10);
  const reason = params.get('reason') || 'Другое';
  const student = state.users.find(u => u.id === userId && u.role === 'student');
  if (!student || !amount || amount < 1) return redirect(res, '/teacher?error=fields');
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const issued = state.transactions
    .filter(t => t.kind === 'credit_teacher' && t.initiator_id === user.id && t.created_at > weekAgo)
    .reduce((s, t) => s + (t.payload.amount || 0), 0);
  if (issued + amount > WEEKLY_LIMIT) return redirect(res, '/teacher?error=limit');
  recordTx('credit_teacher', user.id, { amount, reason, studentId: userId }, [
    { accountId: systemAccount('reserve').id, amount: -amount },
    { accountId: account(userId, 'available').id, amount }
  ]);
  redirect(res, '/teacher?msg=issued');
}

function pageAdmin(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const totalIssued = state.transactions
    .filter(t => ['signup_bonus', 'credit_teacher', 'credit_admin'].includes(t.kind))
    .reduce((s, t) => s + (t.payload.amount || 0), 0);
  const circulating = state.accounts
    .filter(a => a.user_id && (a.kind === 'available' || a.kind === 'held'))
    .reduce((s, a) => s + a.balance, 0);
  const held = state.accounts.filter(a => a.user_id && a.kind === 'held').reduce((s, a) => s + a.balance, 0);
  const burned = systemAccount('burn').balance;
  const reserve = systemAccount('reserve').balance;
  const totalUsers = state.users.length;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const activeUsers = new Set(state.transactions.filter(t => t.created_at > weekAgo && t.initiator_id).map(t => t.initiator_id)).size;
  const tx24h = state.transactions.filter(t => t.created_at > new Date(Date.now() - 24 * 3600 * 1000).toISOString()).length;
  const recentTx = state.transactions.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15).map(t => {
    const init = state.users.find(u => u.id === t.initiator_id);
    return `<tr><td class="muted small">${new Date(t.created_at).toLocaleString('ru-RU')}</td>
      <td>${esc(t.kind)}</td><td>${esc(init ? init.full_name : 'system')}</td>
      <td class="muted small">${esc(JSON.stringify(t.payload))}</td></tr>`;
  }).join('');
  const m = (label, value, accent) => `<div class="card ${accent ? 'balance' : ''}">
    <div class="muted small">${label}</div>
    <div class="metric"><div class="value">${value.toLocaleString('ru-RU')}</div></div></div>`;
  sendHtml(res, layout('Монитор', user, `
    ${flashBox(url)}
    <h1>Economy Monitor</h1>
    <div class="grid grid-4">
      ${m('Total Issued', totalIssued)}
      ${m('Circulating', circulating)}
      ${m('Held (escrow)', held)}
      ${m('Total Burned', burned, true)}
      ${m('Reserve', reserve)}
      ${m('Users', totalUsers)}
      ${m('Active (7d)', activeUsers)}
      ${m('Tx (24h)', tx24h)}
    </div>
    <div class="mt-2"><a href="/admin/users" class="btn btn-primary">Пользователи →</a></div>
    <div class="card mt-2"><h2>Последние транзакции</h2>
      <table><thead><tr><th>Дата</th><th>Тип</th><th>Инициатор</th><th>Payload</th></tr></thead><tbody>${recentTx}</tbody></table>
    </div>`));
}

function pageAdminUsers(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const cards = state.users.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(u => {
    const av = balance(u.id, 'available');
    const hd = balance(u.id, 'held');
    const vr = u.role === 'student' ? balance(u.id, 'vrub') : null;
    const actions = u.role === 'student' ? `
      <div class="mt-2 row">
        <form method="POST" action="/admin/credit" class="row">
          <input type="hidden" name="user_id" value="${u.id}">
          <input name="amount" type="number" min="1" required placeholder="+" style="width:70px;margin:0">
          <input name="reason" required placeholder="причина" style="width:140px;margin:0">
          <button class="btn btn-primary btn-sm">Начислить</button>
        </form>
        <form method="POST" action="/admin/debit" class="row">
          <input type="hidden" name="user_id" value="${u.id}">
          <input name="amount" type="number" min="1" required placeholder="−" style="width:70px;margin:0">
          <input name="reason" required placeholder="причина" style="width:140px;margin:0">
          <button class="btn btn-danger btn-sm">Списать</button>
        </form>
        <form method="POST" action="/admin/block">
          <input type="hidden" name="user_id" value="${u.id}">
          <input type="hidden" name="block" value="${u.is_blocked ? '0' : '1'}">
          <button class="btn btn-ghost btn-sm">${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button>
        </form>
      </div>` : '';
    return `<div class="card">
      <div class="row-between">
        <div><b>${esc(u.full_name)}</b>
          <div class="muted small">${esc(u.email)} · ${u.role}${u.birth_date ? ' · ' + ageStatus(u.birth_date) : ''}${u.class_name ? ' · ' + esc(u.class_name) : ''}${u.is_blocked ? ' · <span class="badge badge-danger">Заблокирован</span>' : ''}</div>
        </div>
        <div style="text-align:right"><div><b>${av}</b> ScRl</div>
          <div class="muted small">${hd} в escrow${vr !== null ? ' · ' + vr + ' vrub' : ''}</div></div>
      </div>
      ${actions}
    </div>`;
  }).join('');
  sendHtml(res, layout('Пользователи', user, `
    ${flashBox(url)}
    <div class="row-between"><h1>Пользователи</h1><a href="/admin" class="btn btn-ghost btn-sm">← Назад</a></div>
    ${cards}`));
}

function handleCredit(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = parseInt(params.get('amount') || '0', 10);
  const reason = (params.get('reason') || '').trim();
  if (!userId || !amount || amount < 1 || !reason) return redirect(res, '/admin/users?error=fields');
  recordTx('credit_admin', admin.id, { amount, reason, target: userId }, [
    { accountId: systemAccount('reserve').id, amount: -amount },
    { accountId: account(userId, 'available').id, amount }
  ]);
  redirect(res, '/admin/users?msg=credited');
}

function handleDebit(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = parseInt(params.get('amount') || '0', 10);
  const reason = (params.get('reason') || '').trim();
  if (!userId || !amount || amount < 1 || !reason) return redirect(res, '/admin/users?error=fields');
  try {
    recordTx('debit_admin', admin.id, { amount, reason, target: userId }, [
      { accountId: account(userId, 'available').id, amount: -amount, note: reason },
      { accountId: systemAccount('reserve').id, amount, note: reason }
    ]);
  } catch (e) {
    return redirect(res, '/admin/users?error=insufficient');
  }
  redirect(res, '/admin/users?msg=debited');
}

function handleBlock(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  if (userId === admin.id) return redirect(res, '/admin/users?error=bad');
  const block = params.get('block') === '1';
  const u = state.users.find(x => x.id === userId);
  if (!u) return redirect(res, '/admin/users?error=notfound');
  u.is_blocked = block;
  save();
  redirect(res, `/admin/users?msg=${block ? 'blocked' : 'unblocked'}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = req.method;
    const user = getSessionUser(req);
    let params = new URLSearchParams();
    if (method === 'POST') {
      const body = await readBody(req);
      params = new URLSearchParams(body);
    }

    if (path === '/login' && method === 'GET') return pageLogin(res, user, url);
    if (path === '/login' && method === 'POST') return doLogin(req, res, params);
    if (path === '/register' && method === 'GET') return pageRegister(res, user, url);
    if (path === '/register' && method === 'POST') return doRegister(req, res, params);
    if (path === '/logout') return doLogout(req, res);

    if (path === '/') {
      if (!user) return redirect(res, '/login');
      return redirect(res, user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/app');
    }

    if (!user) return redirect(res, '/login');
    if (user.is_blocked) {
      for (const [k, v] of sessions) if (v === user.id) sessions.delete(k);
      return redirect(res, '/login?error=blocked_acc');
    }

    if (path === '/app' && method === 'GET') return pageApp(res, user, url);
    if (path === '/wallet' && method === 'GET') return pageWallet(res, user, url);
    if (path === '/market' && method === 'GET') return pageMarket(res, user, url);
    if (path === '/market/create' && method === 'POST') return handleCreateListing(res, user, params);
    if (path === '/market/delete' && method === 'POST') return handleDeleteListing(res, user, params);
    if (path === '/market/buy' && method === 'POST') return handleBuyListing(res, user, params);
    if (path === '/orders' && method === 'GET') return pageOrders(res, user, url);
    if (path === '/orders/deliver' && method === 'POST') return handleDeliver(res, user, params);
    if (path === '/orders/confirm' && method === 'POST') return handleConfirm(res, user, params);
    if (path === '/auctions' && method === 'GET') return pageAuctions(res, user, url);
    if (path === '/auctions/create' && method === 'POST') return handleCreateAuction(res, user, params);
    if (path === '/auctions/bid' && method === 'POST') return handleBid(res, user, params);
    if (path === '/auctions/finish' && method === 'POST') return handleFinishAuction(res, user, params);
    if (path === '/exchange' && method === 'GET') return pageExchange(res, user, url);
    if (path === '/exchange/sell' && method === 'POST') return handleExchangeSell(res, user, params);
    if (path === '/exchange/buy' && method === 'POST') return handleExchangeBuy(res, user, params);
    if (path === '/exchange/cancel' && method === 'POST') return handleExchangeCancel(res, user, params);
    if (path === '/teacher' && method === 'GET') return pageTeacher(res, user, url);
    if (path === '/teacher/issue' && method === 'POST') return handleIssue(res, user, params);
    if (path === '/admin' && method === 'GET') return pageAdmin(res, user, url);
    if (path === '/admin/users' && method === 'GET') return pageAdminUsers(res, user, url);
    if (path === '/admin/credit' && method === 'POST') return handleCredit(res, user, params);
    if (path === '/admin/debit' && method === 'POST') return handleDebit(res, user, params);
    if (path === '/admin/block' && method === 'POST') return handleBlock(res, user, params);

    sendHtml(res, layout('404', user, '<div class="card"><h1>404</h1><p>Страница не найдена</p><a href="/" class="btn btn-primary mt-2">На главную</a></div>'), 404);
  } catch (e) {
    console.error(e);
    sendHtml(res, `<h1>Ошибка</h1><pre>${esc(e.stack || e.message)}</pre><a href="/">На главную</a>`, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  ScRl → http://localhost:${PORT}\n`);
  console.log('  Демо-вход (пароль password123):');
  console.log('    ivan@scrl.demo     — ученик');
  console.log('    masha@scrl.demo    — ученик');
  console.log('    petya@scrl.demo    — ученик 12 лет (торговля заблокирована)');
  console.log('    teacher@scrl.demo  — учитель');
  console.log('    admin@scrl.demo    — администратор\n');
  console.log(`  Данные: ${DATA_FILE}\n`);
});