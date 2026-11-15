const { state, balance } = require('../store');
const { ageStatus, canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { recordTokenRateCandle } = require('../services/token-market');
function pageApp(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const av = balance(user.id, 'available');
  const hd = balance(user.id, 'held');
  const vr = balance(user.id, 'vrub');
  const tradeable = canTrade(user);
  const market = recordTokenRateCandle();
  const rate = market.referenceRate;
  const recent = state.entries
    .filter(e => {
      const acc = state.accounts.find(a => a.id === e.account_id);
      return acc && acc.user_id === user.id && acc.kind === 'available' && e.amount !== 0;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map(e => {
      const tx = state.transactions.find(t => t.id === e.tx_id);
      return `<li class="row-between" style="padding:9px 0;border-bottom:1px solid var(--border);font-size:14px">
        <span class="muted">${esc(tx ? tx.kind : 'Операция')}</span>
        <b class="${e.amount > 0 ? 'badge badge-success' : 'badge badge-danger'}">${e.amount > 0 ? '+' : ''}${e.amount} ScRl</b></li>`;
    }).join('');
  const activeOrders = state.orders
    .filter(o => (o.buyer_id === user.id || o.seller_id === user.id) && ['awaiting_delivery', 'awaiting_confirmation'].includes(o.status))
    .slice(0, 5)
    .map(o => `<li class="row-between" style="padding:8px 0;border-bottom:1px solid var(--border);font-size:14px">
      <span>${o.buyer_id === user.id ? 'Покупка' : 'Продажа'}</span>
      <span class="muted">${o.price} ScRl</span>
      <span class="badge badge-muted">${esc(o.status)}</span></li>`).join('');

  sendHtml(res, layout('Главная', user, `
    ${flashBox(url)}
    <div class="row-between" style="margin-bottom:16px;align-items:end">
      <div><h1 style="margin-bottom:2px">Главная</h1><p class="muted">Всё важное — в одном месте</p></div>
      <span class="badge badge-primary-soft">Личный кабинет</span>
    </div>
    <section class="card balance" style="padding:24px">
      <div class="row-between">
        <div>
          <div class="muted small">Ваш кошелёк · доступно</div>
          <div style="font-size:34px;font-weight:750;letter-spacing:-1px;margin:5px 0">🪙 ${av.toLocaleString('ru-RU')} ScRl</div>
          <div class="muted small">В резерве сделок: ${hd.toLocaleString('ru-RU')} ScRl</div>
        </div>
        <a class="btn btn-primary" href="/wallet">Открыть кошелёк <span aria-hidden="true">→</span></a>
      </div>
      <div class="grid grid-3 mt-2">
        <div><div class="muted small">Доступно</div><b>${av.toLocaleString('ru-RU')} ScRl</b></div>
        <div><div class="muted small">Заблокировано</div><b>${hd.toLocaleString('ru-RU')} ScRl</b></div>
        <div><div class="muted small">Виртуальные рубли</div><b>${vr.toLocaleString('ru-RU')} V-RUB</b></div>
      </div>
    </section>
    ${!tradeable ? `<div class="alert alert-info">Покупки и аукционы доступны с 14 лет. Вы можете просматривать доску и получать токены.</div>` : ''}
    <div class="grid grid-4 mt-2">
      <a href="/board" class="card" style="display:block;color:inherit;text-decoration:none"><span class="muted small">01 · Сообщество</span><h2 class="mt-1">Общая доска</h2><p class="muted small">Ищу помощь и предлагаю свои навыки</p></a>
      <a href="/activity" class="card" style="display:block;color:inherit;text-decoration:none"><span class="muted small">02 · Работа</span><h2 class="mt-1">Активность</h2><p class="muted small">Отклики, сделки и сообщения</p></a>
      <a href="/exchange" class="card" style="display:block;color:inherit;text-decoration:none"><span class="muted small">03 · Обмен</span><h2 class="mt-1">Биржа</h2><p class="muted small">ScRl и виртуальные рубли</p></a>
      <a href="/auctions" class="card" style="display:block;color:inherit;text-decoration:none"><span class="muted small">04 · События</span><h2 class="mt-1">Аукционы</h2><p class="muted small">Внутренние ставки ScRl</p></a>
    </div>
    <div class="grid grid-2 mt-2">
      <section class="card">
        <div class="row-between"><h2>Последние операции</h2><a class="small" href="/wallet">В кошелёк →</a></div>
        ${recent ? `<ul style="list-style:none">${recent}</ul>` : '<p class="muted small">Операций пока нет.</p>'}
      </section>
      <section class="card">
        <div class="row-between"><h2>Активные сделки</h2><a class="small" href="/activity#deals">Все →</a></div>
        ${activeOrders ? `<ul style="list-style:none">${activeOrders}</ul>` : '<p class="muted small">Нет активных заказов.</p>'}
      </section>
    </div>
    <section class="card mt-2">
      <div class="row-between">
        <div><h2>Справочный курс ScRl</h2><p class="muted small">Внутренняя учебная экономика</p></div>
        <a class="btn btn-ghost btn-sm" href="/exchange">Открыть биржу</a>
      </div>
      <div class="mt-1"><div class="muted small">Расчётный ориентир</div><div style="font-size:23px;font-weight:700">1 ScRl = ${rate.toLocaleString('ru-RU', {minimumFractionDigits:4,maximumFractionDigits:4})} V-RUB</div></div>
      <p class="muted small mt-1">Курс рассчитывается по общему балансу виртуальных рублей и общему выпуску ScRl. V-RUB не является реальными рублями и не выводится из системы.</p>
    </section>`));
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
  const vrubRows = (state.vrub_ledger_entries || [])
    .filter(entry => entry.user_id === user.id && ['initial_grant', 'opening_balance'].includes(entry.event_type) && Number(entry.amount) > 0)
    .map(entry => '<tr><td class="muted small">' + new Date(entry.created_at).toLocaleString('ru-RU') + '</td>' +
      '<td>Начальный баланс V-RUB</td><td class="muted">' + esc(entry.reason || 'Стартовое начисление') + '</td>' +
      '<td style="text-align:right" class="badge badge-success">+' + Number(entry.amount).toLocaleString('ru-RU') + ' V-RUB</td></tr>').join('');
  const historyRows = [rows, vrubRows].filter(Boolean).join('');
  sendHtml(res, layout('Кошелёк', user, `
    ${flashBox(url)}
    <h1>Кошелёк</h1>
    <div class="grid grid-4">
      <div class="card"><div class="muted small">Доступно</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'available')} ScRl</div></div>
      <div class="card"><div class="muted small">Заблокировано</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'held')} ScRl</div></div>
      <div class="card"><div class="muted small">V-RUB доступно</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'vrub')}</div></div>
      <div class="card"><div class="muted small">V-RUB заблокировано</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'vrub_held')}</div></div>
      <div class="card"><div class="muted small">Статус</div><div style="font-size:22px;font-weight:700">${ageStatus(user.birth_date)}</div></div>
    </div>
    <div class="row mt-1"><a class="btn btn-ghost btn-sm" href="/exchange">Открыть биржу ScRl / V-RUB</a><a class="btn btn-ghost btn-sm" href="/favorites">Избранное</a></div>
    <div class="card"><h2>История операций</h2>
      ${historyRows ? `<table><thead><tr><th>Дата</th><th>Тип</th><th>Комментарий</th><th style="text-align:right">Сумма</th></tr></thead><tbody>${historyRows}</tbody></table>` : '<p class="muted">Пока пусто</p>'}
    </div>`));
}


module.exports = { pageApp, pageWallet };
