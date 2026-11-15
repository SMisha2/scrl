const crypto = require('node:crypto');
const { state, save, balance } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { notify } = require('../utils/notifications');

function paymentMode() {
  // Live payments are deliberately blocked here until the operator, legal review,
  // provider contract, verification and server-side approvals are completed.
  return process.env.SCRL_PAYMENTS_MODE === 'sandbox' ? 'sandbox' : 'disabled';
}

function pageRubWallet(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const mode = paymentMode();
  const items = state.money_operations.filter(o => o.user_id === user.id && o.mode === 'sandbox')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rows = items.map(o => '<tr><td>' + new Date(o.created_at).toLocaleString('ru-RU') + '</td><td>' + esc(o.type) + '</td><td>' + o.rub_amount.toLocaleString('ru-RU') + ' RUB</td><td>' + esc(o.status) + '</td><td><span class="badge badge-accent">SANDBOX</span></td></tr>').join('');
  const sandboxForm = mode === 'sandbox'
    ? '<div class="grid grid-2"><section class="card"><h2>Тестовое пополнение</h2><p class="muted small">Создаёт только тестовую запись. ScRl не начисляются, реальный платёж не выполняется.</p><form method="POST" action="/wallet/rub/topup"><label>Сумма, RUB</label><input name="amount" type="number" min="1" max="10000" required><button class="btn btn-primary">Создать тестовый платёж</button></form></section>' +
      '<section class="card"><h2>Тестовая заявка на вывод</h2><p class="muted small">Создаёт тестовую заявку без блокировки токенов и без выплаты.</p><form method="POST" action="/wallet/rub/payout"><label>Сумма, ScRl</label><input name="amount" type="number" min="1" required><button class="btn btn-ghost">Создать тестовую заявку</button></form></section></div>'
    : '<div class="alert alert-info">Платёжный модуль не подключён. Реальные пополнения и выплаты недоступны.</div>';
  const banner = mode === 'sandbox'
    ? '<div class="alert alert-info"><b>Тестовый режим — реальные деньги не переводятся.</b> Платёжный партнёр не подключён, записи не изменяют баланс ScRl.</div>'
    : '<div class="alert alert-info"><b>Платёжный модуль отключён.</b> Это не рублёвый кошелёк; ScRl учитывается отдельно от RUB.</div>';
  sendHtml(res, layout('RUB / Платежи', user, flashBox(url) + '<div class="row-between"><div><h1>RUB · Пополнение и вывод</h1><p class="muted">Отдельный контур операций с платёжным партнёром</p></div><a class="btn btn-ghost btn-sm" href="/wallet">К кошельку ScRl</a></div>' +
    banner + '<div class="card"><div class="row-between"><span>Режим</span><b>' + mode.toUpperCase() + '</b></div><p class="muted small mt-1">Предварительный расчётный курс и комиссии настраиваются сервером. Показ курса не является обещанием выкупа.</p></div>' +
    sandboxForm + '<section class="card"><h2>История операций</h2>' + (rows ? '<table><thead><tr><th>Дата</th><th>Операция</th><th>Сумма</th><th>Статус</th><th>Среда</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">Операций пока нет.</p>') + '</section>'));
}

function createSandboxOperation(res, user, params, type) {
  if (user.role !== 'student') return redirect(res, '/');
  if (paymentMode() !== 'sandbox') return redirect(res, '/wallet/rub?error=disabled');
  const amount = Math.floor(Number(params.get('amount') || 0));
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return redirect(res, '/wallet/rub?error=fields');
  if (type === 'payout' && amount > balance(user.id, 'available')) return redirect(res, '/wallet/rub?error=insufficient');
  const rate = Number(state.settings.token_exchange_rate || 1);
  const item = {
    id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    user_id: user.id,
    type,
    mode: 'sandbox',
    currency: 'RUB',
    sc_rl_amount: type === 'topup' ? amount : amount,
    rub_amount: type === 'topup' ? amount : Math.round(amount * rate),
    rate,
    rate_version: Number(state.settings.token_exchange_rate_version || 1),
    fee_rub: 0,
    status: 'sandbox_created',
    real_money_moved: false,
    tokens_credited: false,
    tokens_reserved: false,
    created_at: new Date().toISOString()
  };
  state.money_operations.unshift(item);
  state.financial_audit_logs.push({
    id: crypto.randomUUID(), operation_id: item.id, actor_id: user.id,
    action: 'sandbox_' + type + '_created', reason: 'Sandbox only; no real funds and no token balance change.',
    created_at: new Date().toISOString()
  });
  save();
  notify(user.id, 'finance', 'Тестовая операция создана', 'Это запись sandbox; баланс ScRl не изменён и реальные деньги не переводились.', '/wallet/rub');
  return redirect(res, '/wallet/rub?msg=created');
}

function handleSandboxTopUp(res, user, params) {
  return createSandboxOperation(res, user, params, 'topup');
}
function handleSandboxPayout(res, user, params) {
  return createSandboxOperation(res, user, params, 'payout');
}

function pageFinancialOps(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const rows = state.money_operations.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(o => {
    const owner = state.users.find(u => u.id === o.user_id);
    return '<tr><td>' + esc(o.id.slice(0, 8)) + '</td><td>' + esc(owner ? owner.full_name : '—') + '</td><td>' + esc(o.type) + '</td><td>' + o.sc_rl_amount + ' ScRl</td><td>' + o.rub_amount + ' RUB</td><td>' + esc(o.status) + '</td><td>' + esc(o.mode) + '</td></tr>';
  }).join('');
  const mode = paymentMode();
  sendHtml(res, layout('Financial Operations', user, flashBox(url) + '<div class="row-between"><div><h1>Financial Operations</h1><p class="muted">Журнал денежных операций партнёра, не рублёвые балансы пользователей.</p></div><a class="btn btn-ghost btn-sm" href="/admin">Назад</a></div>' +
    '<div class="alert alert-info">Текущий режим: <b>' + mode.toUpperCase() + '</b>. Live недоступен из приложения. Администратор не может вручную подтвердить оплату или выплату.</div>' +
    '<div class="grid grid-3"><div class="card"><span class="muted small">Операций</span><h2>' + state.money_operations.length + '</h2></div><div class="card"><span class="muted small">Sandbox</span><h2>' + state.money_operations.filter(o => o.mode === 'sandbox').length + '</h2></div><div class="card"><span class="muted small">Реальные операции</span><h2>0</h2></div></div>' +
    '<section class="card"><h2>Журнал</h2>' + (rows ? '<table><thead><tr><th>ID</th><th>Участник</th><th>Тип</th><th>ScRl</th><th>RUB</th><th>Статус</th><th>Режим</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">Операций пока нет.</p>') + '</section>'));
}

module.exports = { pageRubWallet, handleSandboxTopUp, handleSandboxPayout, pageFinancialOps };
