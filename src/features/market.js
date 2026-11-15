const crypto = require('node:crypto');
const { state, account, balance, recordTx, save, systemAccount } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { analyseSubmission } = require('../services/ai-moderation');
const { notify } = require('../utils/notifications');
function orderEscrow(orderId, buyerId) {
  const held = state.accounts.find(item => item.user_id === buyerId && item.kind === 'held');
  if (!held) return { amount: 0, held: null };
  const ids = new Set(state.transactions
    .filter(tx => tx.payload && tx.payload.orderId === orderId)
    .map(tx => tx.id));
  const amount = state.entries
    .filter(entry => ids.has(entry.tx_id) && entry.account_id === held.id)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const settled = state.transactions.some(tx => tx.kind === 'order_settle' && tx.payload && tx.payload.orderId === orderId);
  return { amount, held, settled };
}

function pageMarket(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const tradeable = canTrade(user);
  const othersListings = state.listings.filter(l => l.status === 'active' && l.seller_id !== user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const myListings = state.listings.filter(l => l.seller_id === user.id && ['active', 'pending'].includes(l.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const items = othersListings.map(l => {
    const seller = state.users.find(u => u.id === l.seller_id);
    return `<div class="card">
      <div class="row-between"><b>${esc(l.title)}</b><span class="badge badge-primary-soft">${esc(l.category)}</span></div>
      <div class="muted small mt-1">${esc(seller ? seller.full_name : '')} · ${esc(seller && seller.class_name || '')}</div>
      <p class="mt-1">${esc(l.description)}</p>
      <div class="row-between mt-1"><b class="accent">🪙 ${l.price}</b>
        ${tradeable ? `<form method="POST" action="/market/buy"><input type="hidden" name="listing_id" value="${l.id}"><button class="btn btn-accent btn-sm">Купить</button></form>` : `<span class="muted small">14+</span>`}
      </div>
      <details class="mt-1"><summary class="small muted" style="cursor:pointer">Пожаловаться на объявление</summary>
        <form method="POST" action="/market/report" class="mt-1">
          <input type="hidden" name="listing_id" value="${l.id}">
          <label>Причина</label><select name="reason_code" required>
            <option value="unsafe">Опасный товар или услуга</option><option value="privacy">Личные данные</option>
            <option value="harassment">Оскорбления или угрозы</option><option value="spam">Спам или обман</option><option value="other">Другое</option>
          </select>
          <label>Подробности (необязательно)</label><textarea name="details" rows="2" maxlength="300"></textarea>
          <button class="btn btn-ghost btn-sm">Отправить жалобу</button>
        </form>
      </details></div>`;
  }).join('');

  const mine = myListings.map(l => `<div class="card">
    <div class="row-between">
      <div><b>${esc(l.title)}</b><div class="muted small">${esc(l.category)} · ${l.price} ScRl</div><span class="badge badge-accent">${l.status === "pending" ? "На проверке" : "Активно"}</span></div>
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
    <div class="grid grid-3">${items || '<p class="muted">Пока нет объявлений. Станьте первым продавцом.</p>'}</div>`));
}


async function handleCreateListing(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/market?error=age');
  const title = (params.get('title') || '').trim().slice(0, 80);
  const category = (params.get('category') || 'Другое').trim().slice(0, 40);
  const description = (params.get('description') || '').trim().slice(0, 600);
  const price = Number(params.get('price') || 0);
  if (!title || !description || !category || !Number.isSafeInteger(price) || price < 1 || price > 1000000) {
    return redirect(res, '/market?error=fields');
  }
  const moderation = await analyseSubmission(title + '\n' + description + '\n' + category);
  const listing = {
    id: crypto.randomUUID(), seller_id: user.id, title, category, description, price,
    status: moderation.requiresReview ? 'pending' : 'active',
    moderation_level: moderation.level, moderation_findings: moderation.findings,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  state.listings.unshift(listing);
  if (moderation.requiresReview) {
    state.moderation_cases.unshift({
      id: crypto.randomUUID(), kind: 'listing', target_id: listing.id,
      status: 'open', reason: moderation.findings.map(item => item.label).join('; '),
      recommendation: moderation.recommendation, created_at: new Date().toISOString()
    });
  }
  save();
  if (moderation.requiresReview) {
    state.users.filter(admin => admin.role === 'admin').forEach(admin =>
      notify(admin.id, 'moderation', 'Новое объявление на проверке', 'Требуется проверка объявления «' + listing.title + '».', '/admin/moderation')
    );
  }
  return redirect(res, moderation.requiresReview ? '/market?msg=pending_review' : '/market?msg=created');
}


function handleDeleteListing(res, user, params) {
  const listing = state.listings.find(l => l.id === params.get('listing_id'));
  if (!listing || listing.seller_id !== user.id || !['active', 'pending'].includes(listing.status)) return redirect(res, '/market?error=bad');
  listing.status = 'removed';
  save();
  redirect(res, '/market?msg=deleted');
}


function handleBuyListing(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/market?error=age');
  const listingId = params.get('listing_id');
  const listing = state.listings.find(item => item.id === listingId && item.status === 'active');
  if (!listing) return redirect(res, '/market?error=notfound');
  if (listing.seller_id === user.id) return redirect(res, '/market?error=own');
  const seller = state.users.find(item => item.id === listing.seller_id);
  if (!seller || seller.is_blocked || !canTrade(seller)) return redirect(res, '/market?error=age');
  if (!Number.isSafeInteger(listing.price) || listing.price < 1 ||
      balance(user.id, 'available') < listing.price) return redirect(res, '/market?error=insufficient');

  const orderId = crypto.randomUUID();
  const order = {
    id: orderId, listing_id: listingId, buyer_id: user.id, seller_id: listing.seller_id,
    price: listing.price, commission: Math.floor(listing.price * 0.1),
    status: 'awaiting_delivery', created_at: new Date().toISOString()
  };
  state.orders.unshift(order);
  listing.status = 'in_progress';
  try {
    recordTx('order_hold', user.id, { orderId, listingId, amount: listing.price }, [
      { accountId: account(user.id, 'available').id, amount: -listing.price, note: 'Покупка' },
      { accountId: account(user.id, 'held').id, amount: listing.price, note: 'Escrow' }
    ]);
  } catch (error) {
    state.orders = state.orders.filter(item => item.id !== orderId);
    listing.status = 'active';
    save();
    console.error('Marketplace order hold failed:', error.message);
    return redirect(res, '/market?error=hold');
  }
  return redirect(res, '/orders?msg=purchased');
}


function pageOrders(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const statusLabel = value => ({
    awaiting_delivery: 'Ожидает выполнения',
    awaiting_confirmation: 'Ожидает подтверждения',
    disputed: 'На рассмотрении',
    completed: 'Выполнен',
    refunded: 'Возврат'
  }[value] || value);
  const statusBadge = value => ({
    awaiting_delivery: 'badge-muted',
    awaiting_confirmation: 'badge-accent',
    disputed: 'badge-danger',
    completed: 'badge-success',
    refunded: 'badge-muted'
  }[value] || 'badge-muted');

  const cardFor = (order, role) => {
    const listing = state.listings.find(item => item.id === order.listing_id);
    const other = state.users.find(item => item.id === (role === 'buyer' ? order.seller_id : order.buyer_id));
    const open = ['awaiting_delivery', 'awaiting_confirmation'].includes(order.status);
    let actions = '';
    if (role === 'buyer' && order.status === 'awaiting_confirmation') {
      actions += '<form method="POST" action="/orders/confirm"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-primary btn-sm">Подтвердить выполнение</button></form>';
    }
    if (role === 'seller' && order.status === 'awaiting_delivery') {
      actions += '<form method="POST" action="/orders/deliver"><input type="hidden" name="order_id" value="' + esc(order.id) + '"><button class="btn btn-primary btn-sm">Я выполнил</button></form>';
    }
    if (open) {
      actions += '<details class="mt-1"><summary class="btn btn-ghost btn-sm" style="cursor:pointer">Открыть спор</summary>' +
        '<form method="POST" action="/orders/dispute" class="mt-1"><input type="hidden" name="order_id" value="' + esc(order.id) + '">' +
        '<label>Опишите проблему</label><textarea name="reason" rows="2" maxlength="500" required placeholder="Что произошло?"></textarea>' +
        '<button class="btn btn-ghost btn-sm">Передать модератору</button></form></details>';
    }
    return '<article class="card"><div class="row-between"><div><b>' + esc(listing ? listing.title : 'Заказ Marketplace') + '</b>' +
      '<div class="muted small">' + (role === 'buyer' ? 'Продавец: ' : 'Покупатель: ') + esc(other ? other.full_name : 'Не указано') + '</div></div>' +
      '<div style="text-align:right"><div class="accent"><b>🪙 ' + Number(order.price || 0).toLocaleString('ru-RU') + '</b></div>' +
      '<span class="badge ' + statusBadge(order.status) + '">' + statusLabel(order.status) + '</span></div></div>' +
      (order.dispute_reason ? '<p class="small mt-1">Причина спора: ' + esc(order.dispute_reason) + '</p>' : '') +
      (actions ? '<div class="row mt-2">' + actions + '</div>' : '') + '</article>';
  };

  const buyer = state.orders.filter(order => order.buyer_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const seller = state.orders.filter(order => order.seller_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  sendHtml(res, layout('Заказы', user, flashBox(url) +
    '<h1>Мои заказы</h1><h2>Я покупаю</h2>' +
    (buyer.length ? buyer.map(order => cardFor(order, 'buyer')).join('') : '<p class="muted small">Нет покупок</p>') +
    '<h2 class="mt-2">Я продаю</h2>' +
    (seller.length ? seller.map(order => cardFor(order, 'seller')).join('') : '<p class="muted small">Нет заказов</p>')));
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


function handleOrderDispute(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const order = state.orders.find(item => item.id === params.get('order_id'));
  const reason = (params.get('reason') || '').trim().slice(0, 500);
  if (!order || ![order.buyer_id, order.seller_id].includes(user.id) ||
      !['awaiting_delivery', 'awaiting_confirmation'].includes(order.status) || !reason) {
    return redirect(res, '/orders?error=bad');
  }
  const now = new Date().toISOString();
  order.status = 'disputed';
  order.dispute_reason = reason;
  order.disputed_by = user.id;
  order.disputed_at = now;
  const item = {
    id: crypto.randomUUID(), kind: 'market_order', target_id: order.id,
    status: 'open', reason, created_by: user.id, created_at: now
  };
  state.moderation_cases.unshift(item);
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: user.id, action: 'market_order_disputed',
    target_id: order.id, reason, created_at: now
  });
  save();
  state.users.filter(admin => admin.role === 'admin').forEach(admin =>
    notify(admin.id, 'moderation', 'Спор по заказу Marketplace', reason, '/admin/moderation')
  );
  return redirect(res, '/orders?msg=disputed');
}


function handleConfirm(res, user, params) {
  const orderId = params.get('order_id');
  const order = state.orders.find(item => item.id === orderId);
  if (!order || order.buyer_id !== user.id || order.status !== 'awaiting_confirmation') {
    return redirect(res, '/orders?error=bad');
  }
  const price = Number(order.price);
  if (!Number.isSafeInteger(price) || price < 1) return redirect(res, '/orders?error=order');

  const escrow = orderEscrow(order.id, order.buyer_id);
  if (escrow.settled) {
    order.status = 'completed';
  } else {
    if (!escrow.held || escrow.amount !== price || escrow.held.balance < price) {
      return redirect(res, '/orders?error=escrow');
    }
    const commission = Math.floor(price * 0.1);
    const sellerAmount = price - commission;
    const entries = [
      { accountId: escrow.held.id, amount: -price, note: 'Escrow' },
      { accountId: account(order.seller_id, 'available').id, amount: sellerAmount, note: 'Выплата' }
    ];
    if (commission > 0) {
      const burn = systemAccount('burn');
      if (!burn) return redirect(res, '/orders?error=ledger');
      entries.push({ accountId: burn.id, amount: commission, note: 'Комиссия 10%' });
    }
    try {
      recordTx('order_settle', user.id, { orderId, price, commission }, entries);
    } catch (error) {
      console.error('Marketplace order settlement failed:', error.message);
      return redirect(res, '/orders?error=settlement');
    }
    order.status = 'completed';
  }

  order.confirmed_at = order.confirmed_at || new Date().toISOString();
  const listing = state.listings.find(item => item.id === order.listing_id);
  if (listing) listing.status = 'completed';
  save();
  return redirect(res, '/orders?msg=confirmed');
}


module.exports = { pageMarket, handleCreateListing, handleDeleteListing, handleBuyListing, pageOrders, handleDeliver, handleOrderDispute, handleConfirm };
