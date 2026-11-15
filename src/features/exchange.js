const crypto = require('node:crypto');
const { state, account, balance, recordTx, save, systemAccount } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
function exchangeEscrow(orderId, sellerId) {
  const held = state.accounts.find(item => item.user_id === sellerId && item.kind === 'held');
  if (!held) return { amount: 0, held: null };
  const txIds = new Set(state.transactions
    .filter(tx => tx.payload && tx.payload.orderId === orderId)
    .map(tx => tx.id));
  const amount = state.entries
    .filter(entry => txIds.has(entry.tx_id) && entry.account_id === held.id)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return { amount, held };
}

function pageExchange(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const tradeable = canTrade(user);
  const rateValue = Number(state.settings && state.settings.token_exchange_rate);
  const rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 1;
  const reserve = systemAccount('reserve');
  const reserveBalance = reserve ? reserve.balance : 0;
  const offers = state.exchange_orders.filter(order => {
    if (order.status !== 'active') return false;
    const seller = state.users.find(person => person.id === order.seller_id);
    return Boolean(seller && !seller.is_blocked && canTrade(seller));
  }).sort((a, b) => a.price_per_unit - b.price_per_unit);
  const myOrders = state.exchange_orders.filter(order => order.seller_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
  const rows = offers.map(order => {
    const seller = state.users.find(person => person.id === order.seller_id);
    return '<tr><td>' + esc(seller ? seller.full_name : 'Участник') + '</td><td>' + order.amount + ' ScRl</td>' +
      '<td>' + order.price_per_unit.toFixed(2) + ' V-RUB</td>' +
      '<td style="text-align:right">' + (tradeable && order.seller_id !== user.id
        ? '<form method="POST" action="/exchange/buy" style="display:inline"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-accent btn-sm">Обменять</button></form>' : '') + '</td></tr>';
  }).join('');
  const myRows = myOrders.map(order => '<li class="row-between" style="padding:8px 0;border-bottom:1px solid var(--border);font-size:14px">' +
    '<span>' + order.amount + ' ScRl · ' + order.price_per_unit.toFixed(2) + ' V-RUB / шт.</span>' +
    '<span class="badge badge-muted">' + esc(order.status) + '</span>' +
    (order.status === 'active' ? '<form method="POST" action="/exchange/cancel"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-ghost btn-sm">Отменить</button></form>' : '') + '</li>').join('');
  sendHtml(res, layout('Биржа ScRl / RUB', user, flashBox(url) +
    '<div class="row-between"><div><h1>Биржа ScRl / RUB</h1><p class="muted">Внутренний обмен ScRl на виртуальные рубли.</p></div><span class="badge badge-accent">Симуляция</span></div>' +
    '<div class="grid grid-2">' +
      '<section class="card"><div class="muted small">Справочный курс токена</div><div style="font-size:28px;font-weight:750;margin:5px 0">1 ScRl = ' + rate.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' RUB*</div><p class="muted small">Внутренний ориентир, используемый для расчётных сценариев.</p></section>' +
      '<section class="card"><div class="muted small">Reserve · запас токенов</div><div style="font-size:28px;font-weight:750;margin:5px 0">' + reserveBalance.toLocaleString('ru-RU') + ' ScRl</div><p class="muted small">Текущий остаток системного резерва. Он показывается рядом с курсом, но не является обещанием выкупа.</p></section>' +
    '</div>' +
    '<div class="card"><div class="grid grid-2"><div><div class="muted small">Ваши виртуальные рубли</div><h2>' + balance(user.id, 'vrub').toLocaleString('ru-RU') + ' V-RUB</h2></div><div><div class="muted small">Доступно ScRl</div><h2>' + balance(user.id, 'available').toLocaleString('ru-RU') + ' ScRl</h2></div></div></div>' +
    (tradeable ? '<section class="card"><h2>Создать предложение обмена</h2><p class="muted small">Выставьте токены и задайте цену в виртуальных рублях.</p>' +
      '<form method="POST" action="/exchange/sell"><div class="grid grid-2">' +
      '<div><label>Количество ScRl</label><input name="amount" type="number" min="1" required></div>' +
      '<div><label>Цена за 1 ScRl, V-RUB</label><input name="price" type="number" step="0.01" min="0.01" required value="' + rate.toFixed(2) + '"></div>' +
      '</div><button class="btn btn-primary" type="submit">Разместить предложение</button></form></section>' :
      '<div class="alert alert-info">Операции обмена внутри симуляции доступны с 14 лет.</div>') +
    '<section class="card"><div class="row-between"><h2>Предложения обмена</h2><span class="muted small">' + offers.length + '</span></div>' +
      (rows ? '<table><thead><tr><th>Участник</th><th>Количество</th><th>Цена</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted small">Пока нет активных предложений.</p>') +
    '</section>' +
    '<section class="card"><h2>Мои предложения</h2>' + (myRows ? '<ul style="list-style:none">' + myRows + '</ul>' : '<p class="muted small">Вы пока ничего не выставляли.</p>') + '</section>' +
    '<div class="alert alert-info"><b>Важно:</b> V-RUB — внутренняя учебная единица. Реальные рубли не переводятся, токены не выкупаются за деньги. ' +
    '<a href="/wallet/rub">Статус рублёвых платежей</a>. *Справочный курс не является банковским или рыночным курсом.</div>'
  ));
}



function handleExchangeSell(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/exchange?error=age');
  const amount = Number(params.get('amount') || 0);
  const rawPrice = Number(params.get('price') || 0);
  const price = Math.round(rawPrice * 100) / 100;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000 ||
      !Number.isFinite(price) || price < 0.01 || price > 10000) {
    return redirect(res, '/exchange?error=fields');
  }
  if (balance(user.id, 'available') < amount) return redirect(res, '/exchange?error=insufficient');

  const orderId = crypto.randomUUID();
  const order = {
    id: orderId, seller_id: user.id, amount, price_per_unit: price,
    status: 'active', created_at: new Date().toISOString()
  };
  state.exchange_orders.unshift(order);
  try {
    recordTx('exchange_hold', user.id, { orderId, amount, price }, [
      { accountId: account(user.id, 'available').id, amount: -amount, note: 'Заявка на продажу' },
      { accountId: account(user.id, 'held').id, amount, note: 'Резерв заявки на продажу' }
    ]);
  } catch (error) {
    state.exchange_orders = state.exchange_orders.filter(item => item.id !== orderId);
    save();
    console.error('Exchange hold failed:', error.message);
    return redirect(res, '/exchange?error=hold');
  }
  return redirect(res, '/exchange?msg=sold');
}




function handleExchangeCancel(res, user, params) {
  const orderId = params.get('order_id');
  const order = state.exchange_orders.find(item => item.id === orderId && item.status === 'active');
  if (!order || order.seller_id !== user.id) return redirect(res, '/exchange?error=bad');
  const escrow = exchangeEscrow(order.id, user.id);
  const held = escrow.held;
  if (!held || escrow.amount !== order.amount || held.balance < order.amount) return redirect(res, '/exchange?error=escrow');

  const previousStatus = order.status;
  order.status = 'cancelled';
  order.cancelled_at = new Date().toISOString();
  try {
    recordTx('exchange_cancel', user.id, { orderId, amount: order.amount }, [
      { accountId: held.id, amount: -order.amount, note: 'Отмена заявки' },
      { accountId: account(user.id, 'available').id, amount: order.amount, note: 'Возврат ScRl по отменённой заявке' }
    ]);
  } catch (error) {
    order.status = previousStatus;
    delete order.cancelled_at;
    save();
    console.error('Exchange cancel failed:', error.message);
    return redirect(res, '/exchange?error=refund');
  }
  return redirect(res, '/exchange?msg=cancelled');
}




function handleExchangeBuy(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/exchange?error=age');
  const orderId = params.get('order_id');
  const order = state.exchange_orders.find(item => item.id === orderId && item.status === 'active');
  if (!order) return redirect(res, '/exchange?error=notfound');
  if (order.seller_id === user.id) return redirect(res, '/exchange?error=own');

  const seller = state.users.find(item => item.id === order.seller_id);
  const amount = Number(order.amount);
  const price = Number(order.price_per_unit);
  const cost = Math.round(amount * price);
  if (!seller || seller.is_blocked || !canTrade(seller)) return redirect(res, '/exchange?error=age');
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isFinite(price) || price <= 0 ||
      !Number.isSafeInteger(cost) || cost < 1) return redirect(res, '/exchange?error=order');
  if (balance(user.id, 'vrub') < cost) return redirect(res, '/exchange?error=novrub');

  const escrow = exchangeEscrow(order.id, seller.id);
  const held = escrow.held;
  if (!held || escrow.amount !== amount || held.balance < amount) return redirect(res, '/exchange?error=escrow');
  const commission = Math.min(amount - 1, Math.floor(amount * 0.01));
  const buyerGets = amount - commission;
  const previous = { status: order.status, buyer_id: order.buyer_id, filled_at: order.filled_at };
  order.status = 'filled';
  order.buyer_id = user.id;
  order.filled_at = new Date().toISOString();

  try {
    const entries = [
      { accountId: held.id, amount: -amount, note: 'Продажа ScRl' },
      { accountId: account(user.id, 'available').id, amount: buyerGets, note: 'Покупка ScRl' }
    ];
    if (commission > 0) {
      const burn = systemAccount('burn');
      if (!burn) throw new Error('Burn account is not configured');
      entries.push({ accountId: burn.id, amount: commission, note: 'Комиссия 1%' });
    }
    entries.push(
      { accountId: account(user.id, 'vrub').id, amount: -cost, note: 'Оплата во внутренней симуляции' },
      { accountId: account(seller.id, 'vrub').id, amount: cost, note: 'Начисление во внутренней симуляции' }
    );
    recordTx('exchange_trade', user.id, { orderId, amount, price, cost, commission }, entries);
  } catch (error) {
    order.status = previous.status;
    if (previous.buyer_id === undefined) delete order.buyer_id;
    else order.buyer_id = previous.buyer_id;
    if (previous.filled_at === undefined) delete order.filled_at;
    else order.filled_at = previous.filled_at;
    save();
    console.error('Exchange trade failed:', error.message);
    return redirect(res, '/exchange?error=trade');
  }
  return redirect(res, '/exchange?msg=bought');
}




module.exports = { pageExchange, handleExchangeSell, handleExchangeCancel, handleExchangeBuy };
