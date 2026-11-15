const crypto = require('node:crypto');
const { state, account, balance, recordTx, save, systemAccount } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
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


module.exports = { pageExchange, handleExchangeSell, handleExchangeCancel, handleExchangeBuy };
