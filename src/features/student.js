const { state, balance } = require('../store');
const { ageStatus, canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { recordTokenRateCandle } = require('../services/token-market');
function pageApp(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const available = balance(user.id, 'available');
  const held = balance(user.id, 'held');
  const vrub = balance(user.id, 'vrub');
  const tradeable = canTrade(user);
  const market = recordTokenRateCandle();

  const transactionLabels = {
    signup_bonus: 'Стартовый бонус',
    credit_teacher: 'Начисление учителя',
    credit_admin: 'Начисление школы',
    deal_settlement: 'Оплата по сделке',
    deal_escrow: 'Резерв сделки',
    deal_escrow_refund: 'Возврат резерва',
    transfer: 'Перевод',
    exchange_buy: 'Покупка ScRl',
    exchange_sell: 'Продажа ScRl',
    burn_commission: 'Комиссия биржи'
  };
  const recent = state.entries
    .filter(entry => {
      const acc = state.accounts.find(item => item.id === entry.account_id);
      return acc && acc.user_id === user.id && acc.kind === 'available' && entry.amount !== 0;
    })
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, 5)
    .map(entry => {
      const tx = state.transactions.find(item => item.id === entry.tx_id);
      const label = transactionLabels[tx?.kind] || 'Операция';
      return '<li class="home-list-row"><span>' + esc(label) + '</span><b class="' +
        (entry.amount > 0 ? 'amount-positive' : 'amount-negative') + '">' +
        (entry.amount > 0 ? '+' : '') + Number(entry.amount).toLocaleString('ru-RU') + ' ScRl</b></li>';
    }).join('');

  const statusLabels = {
    accepted: 'Принята',
    in_progress: 'В работе',
    awaiting_confirmation: 'Ждёт подтверждения'
  };
  const activeDeals = (state.deals || [])
    .filter(deal => (deal.buyer_id === user.id || deal.seller_id === user.id) &&
      ['accepted', 'in_progress', 'awaiting_confirmation'].includes(deal.status))
    .sort((x, y) => String(y.updated_at || y.created_at).localeCompare(String(x.updated_at || x.created_at)))
    .slice(0, 5)
    .map(deal => {
      const posts = deal.post_kind === 'demand' ? state.demand_posts : state.offer_posts;
      const post = posts.find(item => item.id === deal.post_id);
      const otherId = deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id;
      const other = state.users.find(item => item.id === otherId);
      return '<li class="home-list-row"><a href="/deal?id=' + encodeURIComponent(deal.id) + '">' +
        esc(post ? post.title : 'Договорённость') + '</a><span class="muted small">' +
        esc(statusLabels[deal.status] || 'Активна') + ' · ' +
        esc(other ? other.full_name : 'Участник') + '</span></li>';
    }).join('');

  const titleName = String(user.full_name || 'ученик').trim().split(/\s+/)[0] || 'ученик';
  const content = flashBox(url) +
    '<header class="home-greeting"><h1>Привет, ' + esc(titleName) + '</h1>' +
    '<p>Найди помощь или предложи свою.</p></header>' +
    '<section class="home-balances" aria-label="Баланс">' +
      '<div class="home-balance"><small>Доступно</small><strong>' + available.toLocaleString('ru-RU') + ' ScRl</strong>' +
        '<span class="muted small">' + held.toLocaleString('ru-RU') + ' ScRl в резерве</span></div>' +
      '<div class="home-balance home-balance-secondary"><small>Виртуальные рубли</small><strong>' +
        vrub.toLocaleString('ru-RU') + ' V-RUB</strong></div>' +
    '</section>' +
    (!tradeable ? '<p class="muted small" style="margin-bottom:18px">Платные сделки и аукционы доступны с 14 лет. Бесплатная помощь доступна всем участникам.</p>' : '') +
    '<nav class="home-actions" aria-label="Основные действия">' +
      '<a class="btn btn-primary" href="/board">Найти помощь или предложить свою</a>' +
      '<a href="/activity">Мои дела</a>' +
      '<a href="/wallet">Кошелёк</a>' +
      '<a href="/auctions">Аукционы</a>' +
    '</nav>' +
    '<section class="earn-guide" id="earn-guide" aria-labelledby="earn-guide-title">' +
      '<div class="earn-guide-heading"><div><h2 id="earn-guide-title">Как получить ScRl</h2>' +
      '<p>Есть четыре понятных способа пополнить баланс.</p></div><a class="small" href="/wallet">История начислений →</a></div>' +
      '<div class="earn-guide-grid">' +
        '<div class="earn-guide-item"><b>1. Стартовый бонус</b><p>При регистрации система начисляет разовый бонус. Его размер зависит от текущего курса и доступного резерва.</p></div>' +
        '<div class="earn-guide-item"><b>2. За вклад в лицей</b><p>Учитель или школа могут поощрить ScRl за помощь другим, проект, достижения или инициативу. Спроси учителя, как отметить свой вклад.</p></div>' +
        '<div class="earn-guide-item"><b>3. За платную помощь</b><p>Предложи свои навыки на доске и заранее согласуй цену. После подтверждения результата заказчиком оплата поступит исполнителю.</p></div>' +
        '<div class="earn-guide-item"><b>4. Обмен на бирже</b><p>ScRl можно обменять на V-RUB или купить за V-RUB. Торговые действия доступны с 14 лет; V-RUB — виртуальные единицы, не реальные деньги. <a href="/exchange">Открыть биржу →</a></p></div>' +
      '</div>' +
      '<p class="muted small" style="margin-top:13px">Важно: публикация объявления и обычный отклик сами по себе не начисляют ScRl автоматически.</p>' +
    '</section>' +
    '<div class="home-sections">' +
      '<section><h2 class="home-section-title">Текущие договорённости</h2>' +
        (activeDeals ? '<ul class="home-list">' + activeDeals + '</ul>' :
          '<p class="muted small" style="padding:12px 0">Пока нет активных договорённостей.</p>') +
        '<a class="small" href="/activity#deals">Все договорённости →</a>' +
      '</section>' +
      '<section><h2 class="home-section-title">Последние операции</h2>' +
        (recent ? '<ul class="home-list">' + recent + '</ul>' :
          '<p class="muted small" style="padding:12px 0">Операций пока нет.</p>') +
        '<a class="small" href="/wallet">История кошелька →</a>' +
      '</section>' +
    '</div>' +
    '<section class="home-rate"><div class="row-between"><div><span class="muted small">Курс ScRl</span>' +
      '<div><strong>1 ScRl = ' + Number(market.referenceRate || 0).toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) +
      ' V-RUB</strong></div></div><a class="small" href="/exchange">Биржа →</a></div>' +
      '<p class="muted small" style="margin-top:5px">V-RUB — внутренняя виртуальная единица, не реальные деньги.</p></section>';

  sendHtml(res, layout('Главная', user, content));
}

function pageWallet(res, user, url) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const transactionLabels = {
    signup_bonus: 'Стартовый бонус',
    credit_teacher: 'Поощрение от учителя',
    credit_admin: 'Начисление школы',
    deal_settlement: 'Оплата за помощь',
    deal_escrow: 'Резерв оплаты по сделке',
    deal_escrow_refund: 'Возврат оплаты по сделке',
    deal_dispute_refund: 'Возврат после спора',
    deal_dispute_release: 'Выплата после спора',
    exchange_trade: 'Покупка ScRl',
    exchange_trade_vrub: 'Покупка V-RUB',
    exchange_hold: 'Резерв на бирже',
    exchange_vrub_hold: 'Резерв V-RUB на бирже',
    exchange_cancel: 'Возврат с биржи',
    exchange_vrub_cancel: 'Возврат V-RUB с биржи',
    transfer: 'Перевод'
  };
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
        <td>${esc(tx ? (transactionLabels[tx.kind] || 'Операция') : 'Операция')}</td><td class="muted">${esc(e.note || '')}</td>
        <td style="text-align:right" class="${e.amount > 0 ? 'badge badge-success' : 'badge badge-danger'}">${e.amount > 0 ? '+' : ''}${Number(e.amount).toLocaleString('ru-RU')}</td></tr>`;
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
    <p class="muted small wallet-intro">Здесь находятся твои балансы и история. <a href="/app#earn-guide">Как получить ScRl?</a></p>
    <div class="grid grid-3">
      <div class="card"><div class="muted small">Доступно</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'available')} ScRl</div></div>
      <div class="card"><div class="muted small">Заблокировано</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'held')} ScRl</div></div>
      <div class="card"><div class="muted small">V-RUB доступно</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'vrub')}</div></div>
      <div class="card"><div class="muted small">V-RUB заблокировано</div><div style="font-size:22px;font-weight:700">${balance(user.id, 'vrub_held')}</div></div>
      <div class="card"><div class="muted small">Статус</div><div style="font-size:22px;font-weight:700">${ageStatus(user.birth_date)}</div></div>
    </div>
    <div class="row mt-1"><a class="btn btn-primary btn-sm" href="/exchange">Обмен ScRl</a><a class="btn btn-ghost btn-sm" href="/auctions">Аукционы</a><a class="btn btn-ghost btn-sm" href="/favorites">Избранное</a><a class="small" href="/app#earn-guide">Откуда брать ScRl?</a></div>
    <div class="card"><h2>История операций</h2>
      ${historyRows ? `<table><thead><tr><th>Дата</th><th>Тип</th><th>Комментарий</th><th style="text-align:right">Сумма</th></tr></thead><tbody>${historyRows}</tbody></table>` : '<p class="muted">Пока пусто</p>'}
    </div>`));
}


module.exports = { pageApp, pageWallet };
