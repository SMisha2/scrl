const crypto = require('node:crypto');
const { state, account, balance, recordTx, save, systemAccount } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { recordTokenRateCandle, recordTokenMarketTrade, getTokenMarketStats, calculateBurnCommission } = require('../services/token-market');

function orderSide(order) {
  return order.side === 'sell_vrub' ? 'sell_vrub' : 'sell_scrl';
}

function exchangeEscrow(orderId, sellerId, side) {
  const accountKind = side === 'sell_vrub' ? 'vrub_held' : 'held';
  const held = state.accounts.find(item => item.user_id === sellerId && item.kind === accountKind);
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
  const market = recordTokenRateCandle();
  const referenceRate = market.marketPrice;
  const inverseRate = referenceRate > 0 ? 1 / referenceRate : 0;
  const tradeable = canTrade(user);
  const offers = state.exchange_orders.filter(order => {
    if (order.status !== 'active') return false;
    const seller = state.users.find(person => person.id === order.seller_id);
    return Boolean(seller && !seller.is_blocked && canTrade(seller));
  }).sort((a, b) => a.price_per_unit - b.price_per_unit);
  const scrlOffers = offers.filter(order => orderSide(order) === 'sell_scrl');
  const vrubOffers = offers.filter(order => orderSide(order) === 'sell_vrub');
  const myOrders = state.exchange_orders.filter(order => order.seller_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);

  const scrlRows = scrlOffers.map(order => {
    const seller = state.users.find(person => person.id === order.seller_id);
    return '<tr><td>' + esc(seller ? seller.full_name : 'Участник') + '</td><td>' +
      order.amount.toLocaleString('ru-RU') + ' ScRl</td><td>' +
      order.price_per_unit.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) + ' V-RUB</td><td style="text-align:right">' +
      (tradeable && order.seller_id !== user.id
        ? '<form method="POST" action="/exchange/buy" style="display:inline"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-accent btn-sm">Купить ScRl</button></form>'
        : '') + '</td></tr>';
  }).join('');

  const vrubRows = vrubOffers.map(order => {
    const seller = state.users.find(person => person.id === order.seller_id);
    return '<tr><td>' + esc(seller ? seller.full_name : 'Участник') + '</td><td>' +
      order.amount.toLocaleString('ru-RU') + ' V-RUB</td><td>' +
      order.price_per_unit.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) + ' ScRl</td><td style="text-align:right">' +
      (tradeable && order.seller_id !== user.id
        ? '<form method="POST" action="/exchange/buy" style="display:inline"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-accent btn-sm">Купить V-RUB</button></form>'
        : '') + '</td></tr>';
  }).join('');

  const myRows = myOrders.map(order => {
    const side = orderSide(order);
    return '<li class="row-between" style="padding:8px 0;border-bottom:1px solid var(--border);font-size:14px">' +
      '<span>' + (side === 'sell_scrl'
        ? order.amount + ' ScRl · ' + order.price_per_unit.toFixed(4) + ' V-RUB / ScRl'
        : order.amount + ' V-RUB · ' + order.price_per_unit.toFixed(4) + ' ScRl / V-RUB') + '</span>' +
      '<span class="badge badge-muted">' + esc(order.status) + '</span>' +
      (order.status === 'active'
        ? '<form method="POST" action="/exchange/cancel"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-ghost btn-sm">Отменить</button></form>'
        : '') + '</li>';
  }).join('');

  const disabledMessage = !tradeable
    ? '<div class="alert alert-info">Размещение и покупка предложений обмена доступны с 14 лет. Просмотр биржи доступен.</div>'
    : '';
  const forms = tradeable
    ? '<div class="grid grid-2">' +
      '<section class="card"><h2>Продать ScRl за V-RUB</h2><p class="muted small">Выставьте токены. Покупатель заплатит виртуальными рублями.</p>' +
      '<form method="POST" action="/exchange/sell"><input type="hidden" name="side" value="sell_scrl">' +
      '<label>Количество ScRl</label><input name="amount" type="number" min="1" max="1000000" required>' +
      '<label>Цена за 1 ScRl, V-RUB</label><input name="price" type="number" min="0.0001" max="10000" step="0.0001" required value="' + (referenceRate > 0 ? referenceRate.toFixed(4) : '0.0100') + '">' +
      '<button class="btn btn-primary" type="submit">Выставить ScRl</button></form></section>' +
      '<section class="card"><h2>Продать V-RUB за ScRl</h2><p class="muted small">Выставьте виртуальные рубли. Покупатель заплатит ScRl.</p>' +
      '<form method="POST" action="/exchange/sell"><input type="hidden" name="side" value="sell_vrub">' +
      '<label>Количество V-RUB</label><input name="amount" type="number" min="1" max="1000000" required>' +
      '<label>Цена за 1 V-RUB, ScRl</label><input name="price" type="number" min="0.0001" max="10000" step="0.0001" required value="' + (inverseRate > 0 ? inverseRate.toFixed(4) : '1.0000') + '">' +
      '<button class="btn btn-primary" type="submit">Выставить V-RUB</button></form></section></div>'
    : '';

  sendHtml(res, layout('Биржа ScRl / V-RUB', user, flashBox(url) +
    '<div class="row-between"><div><h1>Биржа ScRl / V-RUB</h1><p class="muted">Два направления обмена внутри учебной экономики.</p></div><span class="badge badge-accent">Симуляция</span></div>' +
    '<section class="card"><div class="row-between"><div><div class="muted small">Рыночная цена по сделкам за 7 дней</div><h2>1 ScRl = ' +
      referenceRate.toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ' V-RUB</h2></div>' +
      '<a class="btn btn-ghost btn-sm" href="/wallet">К кошельку</a></div>' +
      '<div class="grid grid-3 mt-1"><div><div class="muted small">Обеспеченный ориентир</div><b>' + market.backedRate.toFixed(4) + ' V-RUB / ScRl</b></div>' +
      '<div><div class="muted small">Покрытие</div><b>' + (market.coverageRatio * 100).toFixed(1) + '%</b></div>' +
      '<div><div class="muted small">Комиссия сжигания</div><b>' + (market.burnFeeRate * 100).toFixed(2) + '%</b></div></div>' +
      (market.excessScRl > 0 ? '<div class="alert alert-info mt-1">В обращении на ' + market.excessScRl.toLocaleString('ru-RU') + ' ScRl больше обеспеченного лимита. Комиссия повышена, её часть сжигает токены.</div>' : '') +
      '<p class="muted small mt-1">Рыночная цена меняется после совершённых обменов. Покрытие рассчитывается отдельно: V-RUB в кошельках / целевой курс. V-RUB — виртуальные единицы, не реальные рубли.</p></section>' +
    '<div class="grid grid-2"><section class="card"><div class="muted small">Доступно ScRl</div><div style="font-size:24px;font-weight:700">' +
      balance(user.id, 'available').toLocaleString('ru-RU') + ' ScRl</div></section><section class="card"><div class="muted small">Доступно V-RUB</div><div style="font-size:24px;font-weight:700">' +
      balance(user.id, 'vrub').toLocaleString('ru-RU') + ' V-RUB</div><div class="muted small">Заблокировано: ' +
      balance(user.id, 'vrub_held').toLocaleString('ru-RU') + ' V-RUB</div></section></div>' +
    disabledMessage + forms +
    '<section class="card"><div class="row-between"><h2>Купить ScRl за V-RUB</h2><span class="muted small">' + scrlOffers.length + ' предложений</span></div>' +
      (scrlRows ? '<table><thead><tr><th>Участник</th><th>Количество</th><th>Цена за ScRl</th><th></th></tr></thead><tbody>' + scrlRows + '</tbody></table>' : '<p class="muted small">Пока нет предложений продажи ScRl.</p>') +
    '</section>' +
    '<section class="card"><div class="row-between"><h2>Купить V-RUB за ScRl</h2><span class="muted small">' + vrubOffers.length + ' предложений</span></div>' +
      (vrubRows ? '<table><thead><tr><th>Участник</th><th>Количество</th><th>Цена за V-RUB</th><th></th></tr></thead><tbody>' + vrubRows + '</tbody></table>' : '<p class="muted small">Пока нет предложений продажи V-RUB.</p>') +
    '</section>' +
    '<section class="card"><h2>Мои предложения</h2>' + (myRows ? '<ul style="list-style:none">' + myRows + '</ul>' : '<p class="muted small">Вы пока ничего не выставляли.</p>') + '</section>' +
    '<div class="alert alert-info"><b>Важно:</b> V-RUB не является реальными рублями. Реальные пополнения, выплаты и обмен на деньги отключены. Биржа работает только с внутренними балансами ScRl и V-RUB.</div>'
  ));
}

function handleExchangeSell(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/exchange?error=age');
  const side = params.get('side') === 'sell_vrub' ? 'sell_vrub' : 'sell_scrl';
  const amount = Number(params.get('amount') || 0);
  const rawPrice = Number(params.get('price') || 0);
  const price = Math.round(rawPrice * 10000) / 10000;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000 ||
      !Number.isFinite(price) || price < 0.0001 || price > 10000) {
    return redirect(res, '/exchange?error=fields');
  }
  const sourceKind = side === 'sell_vrub' ? 'vrub' : 'available';
  const heldKind = side === 'sell_vrub' ? 'vrub_held' : 'held';
  if (balance(user.id, sourceKind) < amount) return redirect(res, '/exchange?error=insufficient');

  const orderId = crypto.randomUUID();
  const order = {
    id: orderId, seller_id: user.id, side, amount, price_per_unit: price,
    status: 'active', created_at: new Date().toISOString()
  };
  state.exchange_orders.unshift(order);
  try {
    recordTx(side === 'sell_vrub' ? 'exchange_vrub_hold' : 'exchange_hold', user.id,
      { orderId, side, amount, price }, [
        { accountId: account(user.id, sourceKind).id, amount: -amount, note: 'Резерв заявки биржи' },
        { accountId: account(user.id, heldKind).id, amount, note: 'Заблокировано для заявки биржи' }
      ]);
  } catch (error) {
    state.exchange_orders = state.exchange_orders.filter(item => item.id !== orderId);
    save();
    console.error('Exchange order hold failed:', error.message);
    return redirect(res, '/exchange?error=hold');
  }
  recordTokenRateCandle();
  return redirect(res, '/exchange?msg=sold');
}

function handleExchangeCancel(res, user, params) {
  const order = state.exchange_orders.find(item => item.id === params.get('order_id') && item.status === 'active');
  if (!order || order.seller_id !== user.id) return redirect(res, '/exchange?error=bad');
  const side = orderSide(order);
  const heldKind = side === 'sell_vrub' ? 'vrub_held' : 'held';
  const availableKind = side === 'sell_vrub' ? 'vrub' : 'available';
  const escrow = exchangeEscrow(order.id, user.id, side);
  const held = escrow.held;
  if (!held || escrow.amount !== order.amount || held.balance < order.amount) return redirect(res, '/exchange?error=escrow');

  const previousStatus = order.status;
  order.status = 'cancelled';
  order.cancelled_at = new Date().toISOString();
  try {
    recordTx(side === 'sell_vrub' ? 'exchange_vrub_cancel' : 'exchange_cancel', user.id,
      { orderId: order.id, amount: order.amount, side }, [
        { accountId: held.id, amount: -order.amount, note: 'Отмена заявки биржи' },
        { accountId: account(user.id, availableKind).id, amount: order.amount, note: 'Возврат средств по отменённой заявке' }
      ]);
  } catch (error) {
    order.status = previousStatus;
    delete order.cancelled_at;
    save();
    console.error('Exchange cancel failed:', error.message);
    return redirect(res, '/exchange?error=refund');
  }
  recordTokenRateCandle();
  return redirect(res, '/exchange?msg=cancelled');
}

function handleExchangeBuy(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/exchange?error=age');
  const order = state.exchange_orders.find(item => item.id === params.get('order_id') && item.status === 'active');
  if (!order) return redirect(res, '/exchange?error=notfound');
  if (order.seller_id === user.id) return redirect(res, '/exchange?error=own');

  const side = orderSide(order);
  const seller = state.users.find(item => item.id === order.seller_id);
  const amount = Number(order.amount);
  const price = Number(order.price_per_unit);
  const cost = Math.round(amount * price);
  if (!seller || seller.is_blocked || !canTrade(seller)) return redirect(res, '/exchange?error=age');
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isFinite(price) ||
      price < 0.0001 || price > 10000 || !Number.isSafeInteger(cost) || cost < 1) {
    return redirect(res, '/exchange?error=order');
  }

  const escrow = exchangeEscrow(order.id, seller.id, side);
  const held = escrow.held;
  if (!held || escrow.amount !== amount || held.balance < amount) return redirect(res, '/exchange?error=escrow');

  const marketBefore = getTokenMarketStats();
  const previous = { status: order.status, buyer_id: order.buyer_id, filled_at: order.filled_at };
  let executedTrade = null;
  order.status = 'filled';
  order.buyer_id = user.id;
  order.filled_at = new Date().toISOString();

  try {
    let entries;
    if (side === 'sell_vrub') {
      // Buyer pays ScRl for the seller's V-RUB. The fee is burned in ScRl.
      const commission = calculateBurnCommission(cost, marketBefore);
      const sellerGets = cost - commission;
      if (balance(user.id, 'available') < cost) {
        order.status = previous.status;
        delete order.buyer_id;
        delete order.filled_at;
        return redirect(res, '/exchange?error=insufficient');
      }
      entries = [
        { accountId: held.id, amount: -amount, note: 'Продажа V-RUB' },
        { accountId: account(user.id, 'vrub').id, amount, note: 'Покупка V-RUB' },
        { accountId: account(user.id, 'available').id, amount: -cost, note: 'Оплата V-RUB в ScRl' },
        { accountId: account(seller.id, 'available').id, amount: sellerGets, note: 'Получено ScRl за V-RUB' }
      ];
      if (commission > 0) {
        const burn = systemAccount('burn');
        if (!burn) throw new Error('Burn account is not configured');
        entries.push({ accountId: burn.id, amount: commission, note: 'Динамическая комиссия биржи — сжигание ScRl' });
      }
      recordTx('exchange_trade_vrub', user.id,
        { orderId: order.id, side, amount, price, cost, costCurrency: 'ScRl', commission, commissionRate: marketBefore.burnFeeRate },
        entries);
      executedTrade = { amountScRl: sellerGets, amountVrub: amount, feeScRl: commission };
    } else {
      // Buyer pays V-RUB for ScRl. The fee is withheld from delivery and burned.
      const commission = calculateBurnCommission(amount, marketBefore);
      const buyerGets = amount - commission;
      if (balance(user.id, 'vrub') < cost) {
        order.status = previous.status;
        delete order.buyer_id;
        delete order.filled_at;
        return redirect(res, '/exchange?error=novrub');
      }
      entries = [
        { accountId: held.id, amount: -amount, note: 'Продажа ScRl' },
        { accountId: account(user.id, 'available').id, amount: buyerGets, note: 'Покупка ScRl за V-RUB' },
        { accountId: account(user.id, 'vrub').id, amount: -cost, note: 'Оплата в V-RUB' },
        { accountId: account(seller.id, 'vrub').id, amount: cost, note: 'Получено V-RUB за ScRl' }
      ];
      if (commission > 0) {
        const burn = systemAccount('burn');
        if (!burn) throw new Error('Burn account is not configured');
        entries.push({ accountId: burn.id, amount: commission, note: 'Динамическая комиссия биржи — сжигание ScRl' });
      }
      recordTx('exchange_trade', user.id,
        { orderId: order.id, side, amount, price, cost, costCurrency: 'V-RUB', commission, commissionRate: marketBefore.burnFeeRate },
        entries);
      executedTrade = { amountScRl: buyerGets, amountVrub: cost, feeScRl: commission };
    }
  } catch (error) {
    order.status = previous.status;
    if (previous.buyer_id === undefined) delete order.buyer_id;
    else order.buyer_id = previous.buyer_id;
    if (previous.filled_at === undefined) delete order.filled_at;
    else order.filled_at = previous.filled_at;
    save();
    console.error('Exchange trade failed:', error.message);
    return redirect(res, error.code === 'backing_limit' ? '/exchange?error=backing_limit' : '/exchange?error=trade');
  }

  try {
    recordTokenMarketTrade({
      orderId: order.id,
      side,
      buyerId: user.id,
      sellerId: seller.id,
      amountScRl: executedTrade.amountScRl,
      amountVrub: executedTrade.amountVrub,
      feeScRl: executedTrade.feeScRl
    });
  } catch (error) {
    console.error('Market price recording failed:', error.message);
    recordTokenRateCandle();
  }
  return redirect(res, '/exchange?msg=bought');
}


module.exports = { pageExchange, handleExchangeSell, handleExchangeCancel, handleExchangeBuy };
