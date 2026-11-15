const crypto = require('node:crypto');
const { state, save, balance } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { notify } = require('../utils/notifications');
const { getTokenMarketStats, recordTokenRateCandle } = require('../services/token-market');

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
  const rate = getTokenMarketStats().referenceRate;
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
  return redirect(res, '/wallet/rub?msg=sandbox_created');
}

function handleSandboxTopUp(res, user, params) {
  return createSandboxOperation(res, user, params, 'topup');
}
function handleSandboxPayout(res, user, params) {
  return createSandboxOperation(res, user, params, 'payout');
}

function candlestickSvg(candles) {
  if (!candles.length) return '<div class="card"><p class="muted">Пока нет записей курса.</p></div>';
  const width = 760;
  const height = 260;
  const padding = 36;
  const values = candles.flatMap(item => [Number(item.high) || 0, Number(item.low) || 0]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 0.000001) {
    const delta = Math.max(Math.abs(max) * 0.05, 0.01);
    min = Math.max(0, min - delta);
    max += delta;
  }
  const plotHeight = height - padding * 2;
  const plotWidth = width - padding * 2;
  const y = value => padding + ((max - value) / (max - min)) * plotHeight;
  const slot = plotWidth / candles.length;
  const barWidth = Math.max(4, Math.min(18, slot * 0.55));
  const shapes = candles.map((item, index) => {
    const x = padding + slot * (index + 0.5);
    const open = Number(item.open) || 0;
    const close = Number(item.close) || 0;
    const high = Number(item.high) || 0;
    const low = Number(item.low) || 0;
    const color = close > open ? '#16866C' : close < open ? '#C76B66' : '#87939E';
    const top = Math.min(y(open), y(close));
    const bodyHeight = Math.max(2, Math.abs(y(open) - y(close)));
    return '<line x1="' + x.toFixed(2) + '" y1="' + y(high).toFixed(2) + '" x2="' + x.toFixed(2) + '" y2="' + y(low).toFixed(2) + '" stroke="' + color + '" stroke-width="1.5"/>' +
      '<rect x="' + (x - barWidth / 2).toFixed(2) + '" y="' + top.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + bodyHeight.toFixed(2) + '" rx="1.5" fill="' + color + '"/>';
  }).join('');
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Свечной график внутреннего курса V-RUB за ScRl" style="display:block;width:100%;height:auto">' +
    '<line x1="' + padding + '" y1="' + padding + '" x2="' + padding + '" y2="' + (height - padding) + '" stroke="currentColor" opacity=".22"/>' +
    '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="currentColor" opacity=".22"/>' +
    shapes +
    '<text x="5" y="' + (padding + 4) + '" fill="currentColor" font-size="10">' + max.toFixed(4) + '</text>' +
    '<text x="5" y="' + (height - padding) + '" fill="currentColor" font-size="10">' + min.toFixed(4) + '</text>' +
    '<text x="' + padding + '" y="' + (height - 10) + '" fill="currentColor" font-size="10">' + new Date(candles[0].bucket).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit' }) + '</text>' +
    '<text x="' + (width - padding) + '" y="' + (height - 10) + '" text-anchor="end" fill="currentColor" font-size="10">' + new Date(candles[candles.length - 1].bucket).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit' }) + '</text>' +
    '</svg>';
}

function pageTokenMarket(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const market = recordTokenRateCandle();
  const rows = market.candles.slice().reverse().slice(0, 24).map(item =>
    '<tr><td>' + new Date(item.bucket).toLocaleString('ru-RU') + '</td>' +
    '<td>' + Number(item.open).toFixed(4) + '</td><td>' + Number(item.high).toFixed(4) + '</td>' +
    '<td>' + Number(item.low).toFixed(4) + '</td><td>' + Number(item.close).toFixed(4) + '</td>' +
    '<td>' + Number(item.samples || 0) + '</td></tr>'
  ).join('');
  const money = value => Number(value || 0).toLocaleString('ru-RU');
  sendHtml(res, layout('Курс ScRl', user, flashBox(url) +
    '<div class="row-between"><div><h1>Курс ScRl</h1><p class="muted">Внутренний расчёт экономики · только V-RUB</p></div><a href="/admin" class="btn btn-ghost btn-sm">← Монитор</a></div>' +
    '<div class="grid grid-3">' +
      '<div class="card"><div class="muted small">Текущий курс</div><div style="font-size:25px;font-weight:750">' + market.referenceRate.toFixed(4) + ' V-RUB</div><div class="muted small">за 1 ScRl</div></div>' +
      '<div class="card"><div class="muted small">V-RUB в кошельках</div><div style="font-size:25px;font-weight:750">' + money(market.virtualRubleSupply) + '</div></div>' +
      '<div class="card"><div class="muted small">Весь выпуск ScRl</div><div style="font-size:25px;font-weight:750">' + money(market.totalIssuedScRl) + '</div></div>' +
      '<div class="card"><div class="muted small">В обращении</div><div style="font-size:22px;font-weight:700">' + money(market.circulatingScRl) + ' ScRl</div></div>' +
      '<div class="card"><div class="muted small">Резерв токенов</div><div style="font-size:22px;font-weight:700">' + money(market.reserveScRl) + ' ScRl</div></div>' +
      '<div class="card"><div class="muted small">Сожжено</div><div style="font-size:22px;font-weight:700">' + money(market.burnedScRl) + ' ScRl</div></div>' +
    '</div>' +
    '<section class="card mt-2"><div class="row-between"><h2>Свечной график курса</h2><span class="muted small">Почасовые наблюдения · до 14 дней</span></div>' +
      '<p class="muted small">Зелёная свеча — курс вырос за час, красная — снизился, серая — не изменился.</p>' +
      '<div class="mt-1">' + candlestickSvg(market.candles) + '</div>' +
    '</section>' +
    '<section class="card"><h2>Как рассчитывается курс</h2><p><b>Курс = V-RUB в кошельках участников ÷ весь выпуск ScRl.</b></p>' +
      '<p class="muted small mt-1">В выпуск входят доступные и заблокированные токены участников, системный резерв и сожжённые токены. Сделки проверяют остатки счетов до записи, поэтому нельзя потратить больше имеющегося баланса.</p>' +
      '<div class="alert alert-info mt-1"><b>Реальное покрытие RUB: 0.</b> Платёжный партнёр и реальные пополнения/выводы не подключены. V-RUB — только внутренняя виртуальная единица; график не показывает банковский курс и не обещает выкуп токенов за деньги.</div>' +
    '</section>' +
    '<section class="card"><h2>История свечей</h2>' +
      (rows ? '<table><thead><tr><th>Час</th><th>Открытие</th><th>Максимум</th><th>Минимум</th><th>Закрытие</th><th>Снимков</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">История пока пуста.</p>') +
    '</section>'
  ));
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

module.exports = { pageRubWallet, handleSandboxTopUp, handleSandboxPayout, pageFinancialOps, pageTokenMarket };
