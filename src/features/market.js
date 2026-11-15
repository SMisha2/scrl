const crypto = require('node:crypto');
const { state, account, balance, recordTx, save, systemAccount } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { analyseText } = require('../services/moderation-rules');
const { notify } = require('../utils/notifications');
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
      </div></div>`;
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
    <div class="grid grid-3">${items || '<p class="muted">Пока нет объявлений — станьте первым продавцом.</p>'}</div>`));
}


function handleCreateListing(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/market?error=age');
  const title = (params.get('title') || '').trim().slice(0, 80);
  const category = (params.get('category') || 'Другое').trim().slice(0, 40);
  const description = (params.get('description') || '').trim().slice(0, 600);
  const price = Number(params.get('price') || 0);
  if (!title || !description || !category || !Number.isSafeInteger(price) || price < 1 || price > 1000000) {
    return redirect(res, '/market?error=fields');
  }
  const moderation = analyseText(title + '\n' + description + '\n' + category);
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
  const listing = state.listings.find(l => l.id === listingId && l.status === 'active');
  if (!listing) return redirect(res, '/market?error=notfound');
  if (listing.seller_id === user.id) return redirect(res, '/market?error=own');
  const seller = state.users.find(item => item.id === listing.seller_id);
  if (!seller || !canTrade(seller)) return redirect(res, '/market?error=age');
  if (!Number.isSafeInteger(listing.price) || listing.price < 1 || balance(user.id, 'available') < listing.price) return redirect(res, '/market?error=insufficient');

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


module.exports = { pageMarket, handleCreateListing, handleDeleteListing, handleBuyListing, pageOrders, handleDeliver, handleConfirm };
