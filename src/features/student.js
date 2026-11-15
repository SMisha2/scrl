const { state, balance } = require('../store');
const { ageStatus, canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
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
      <a href="/marketplace" class="card" style="text-decoration:none;color:inherit"><b>Каталог</b><div class="muted small">Спрос и предложения</div></a>
      <a href="/demand" class="card" style="text-decoration:none;color:inherit"><b>Мне нужно</b><div class="muted small">Создать запрос</div></a>
      <a href="/offer" class="card" style="text-decoration:none;color:inherit"><b>Я могу</b><div class="muted small">Опубликовать навык</div></a>
      <a href="/deals" class="card" style="text-decoration:none;color:inherit"><b>Мои сделки</b><div class="muted small">Статусы и переписка</div></a>
      <a href="/auctions" class="card" style="text-decoration:none;color:inherit"><b>Аукционы</b><div class="muted small">Внутренние ставки ScRl</div></a>
      <a href="/notifications" class="card" style="text-decoration:none;color:inherit"><b>Уведомления</b><div class="muted small">Отклики и сообщения</div></a>
    </div></a>
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
    <div class="row mt-1"><a class="btn btn-ghost btn-sm" href="/wallet/rub">RUB операции и статус платёжного модуля</a><a class="btn btn-ghost btn-sm" href="/favorites">Избранное</a></div>
    <div class="card"><h2>История операций</h2>
      ${rows ? `<table><thead><tr><th>Дата</th><th>Тип</th><th>Комментарий</th><th style="text-align:right">Сумма</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Пока пусто</p>'}
    </div>`));
}


module.exports = { pageApp, pageWallet };
