const crypto = require('node:crypto');
const { state, save, account, balance, systemAccount, recordTx } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { notify, unreadCount } = require('../utils/notifications');
const { analyseSubmission } = require('../services/ai-moderation');
const { parseDeadline, resolvePostTerms } = require('../services/board-rules');

function dealLedgerState(deal) {
  const held = state.accounts.find(item => item.user_id === deal.buyer_id && item.kind === 'held');
  if (!held) return { escrow: 0, settlement: null, held: null };
  const txs = state.transactions.filter(tx => tx.payload && tx.payload.dealId === deal.id);
  const ids = new Set(txs.map(tx => tx.id));
  const escrow = state.entries
    .filter(entry => ids.has(entry.tx_id) && entry.account_id === held.id)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const settlement = txs.find(tx => [
    'deal_settlement', 'deal_escrow_refund',
    'deal_dispute_refund', 'deal_dispute_release'
  ].includes(tx.kind)) || null;
  return { escrow, settlement, held };
}

const PRICE_MODES = {
  fixed: 'Фиксированная цена',
  range: 'Диапазон цены',
  negotiable: 'Договорная',
  free: 'Бесплатно',
  barter: 'Обмен'
};

function moneyLabel(post) {
  if (post.price_mode === 'free') return 'Бесплатно';
  if (post.price_mode === 'barter') return 'Обмен';
  if (post.price_mode === 'negotiable') return 'Договорная цена';
  if (post.price_mode === 'range') return (post.price_min || 0) + '–' + (post.price_max || 0) + ' ScRl';
  return (post.price || 0) + ' ScRl';
}


function deadlineMarkup(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return '<time data-deadline-date="' + esc(raw) + '">' + esc(raw) + '</time>';
  }
  return '<time data-deadline-utc="' + esc(raw) + '">' + esc(raw) + '</time>';
}

function renderBoardPostForm(categories, initial = {}, errorMessage = '') {
  const defaultMode = initial.force_free ? 'free' : 'negotiable';
  const mode = PRICE_MODES[initial.price_mode] ? initial.price_mode : defaultMode;
  const kind = initial.post_kind === 'offer' ? 'offer' : 'demand';
  const options = Object.entries(PRICE_MODES).map(([key, label]) =>
    '<option value="' + key + '"' + (mode === key ? ' selected' : '') + (initial.force_free && key !== 'free' ? ' disabled' : '') + '>' + label + '</option>'
  ).join('');
  const categoryOptions = categories.map(value => '<option value="' + esc(value) + '">').join('');
  const price = initial.price === undefined ? '' : String(initial.price);
  const priceMax = initial.price_max === undefined ? '' : String(initial.price_max);
  const deadline = String(initial.deadline || '');
  const script = '<script>(function(){' +
    'const form=document.getElementById("board-create-form");if(!form)return;' +
    'const mode=form.elements.price_mode,price=form.elements.price,max=form.elements.price_max;' +
    'const priceWrap=form.querySelector("[data-price-wrap]"),maxWrap=form.querySelector("[data-price-max-wrap]");' +
    'const label=form.querySelector("[data-price-label]"),kind=form.elements.post_kind;' +
    'const title=form.elements.title,description=form.elements.description,deadline=form.elements.deadline,offset=form.elements.deadline_offset;' +
    'function updatePrice(){const fixed=mode.value==="fixed",range=mode.value==="range";' +
    'priceWrap.hidden=!(fixed||range);maxWrap.hidden=!range;price.disabled=!(fixed||range);max.disabled=!range;' +
    'price.required=fixed||range;max.required=range;price.min=(fixed||range)?"1":"0";max.min=range?"1":"0";' +
    'label.textContent=range?"Цена от, ScRl":"Цена, ScRl";' +
    'if(!fixed&&!range){price.value="";max.value="";}else if(fixed){max.value="";}' +
    'if(range){max.min=price.value||"1";}}' +
    'function updateKind(){title.placeholder=kind.value==="demand"?"Например: нужна помощь с Python":"Например: помогу с Python";' +
    'description.placeholder=kind.value==="demand"?"Опишите, с чем нужна помощь":"Опишите, чем вы можете помочь";}' +
    'function localValue(date){const p=n=>String(n).padStart(2,"0");return date.getFullYear()+"-"+p(date.getMonth()+1)+"-"+p(date.getDate())+"T"+p(date.getHours())+":"+p(date.getMinutes());}' +
    'if(deadline){const minDate=new Date();minDate.setSeconds(0,0);minDate.setMinutes(minDate.getMinutes()+2);deadline.min=localValue(minDate);' +
    'function syncOffset(){if(!deadline.value){offset.value="0";deadline.setCustomValidity("");return;}' +
    'const parsed=new Date(deadline.value);if(Number.isNaN(parsed.getTime())){deadline.setCustomValidity("Проверьте дату и время.");return;}' +
    'offset.value=String(parsed.getTimezoneOffset());deadline.setCustomValidity(parsed.getTime()<Date.now()-60000?"Срок должен быть в будущем.":"");}' +
    'deadline.addEventListener("change",syncOffset);deadline.addEventListener("input",syncOffset);form.addEventListener("submit",syncOffset);syncOffset();}' +
    'mode.addEventListener("change",updatePrice);price.addEventListener("input",function(){if(mode.value==="range")max.min=price.value||"1";});' +
    'kind.addEventListener("change",updateKind);updatePrice();updateKind();})();</script>';
  return '<section class="card"><div class="row-between"><div><h2>Новая публикация</h2><p class="muted small">Опишите, что вам нужно или чем вы можете помочь.</p></div><span class="badge badge-primary-soft">Бесплатно или за ScRl</span></div>' +
    (errorMessage ? '<div class="alert alert-danger mt-1">' + esc(errorMessage) + '</div>' : '') +
    '<form id="board-create-form" method="POST" action="/board/create" class="mt-1">' +
    '<div class="grid grid-2"><div><label>Тип публикации</label><select name="post_kind"><option value="demand"' + (kind === 'demand' ? ' selected' : '') + '>Мне нужна помощь</option><option value="offer"' + (kind === 'offer' ? ' selected' : '') + '>Я могу помочь</option></select></div>' +
    '<div><label>Категория</label><input name="category" maxlength="40" required list="board-categories" value="' + esc(initial.category || '') + '" placeholder="Например, программирование"><datalist id="board-categories">' + categoryOptions + '<option value="Учёба"><option value="Дизайн"><option value="Разработка"><option value="Творчество"><option value="Помощь"></datalist></div></div>' +
    '<label>Название</label><input name="title" maxlength="100" required value="' + esc(initial.title || '') + '" placeholder="' + (kind === 'demand' ? 'Например: нужна помощь с Python' : 'Например: помогу с Python') + '">' +
    '<label>Описание</label><textarea name="description" rows="3" maxlength="1500" required placeholder="' + (kind === 'demand' ? 'Опишите, с чем нужна помощь' : 'Опишите, чем вы можете помочь') + '">' + esc(initial.description || '') + '</textarea>' +
    '<div class="grid grid-2"><div><label>Условия</label><select name="price_mode">' + options + '</select></div>' +
    '<div data-price-wrap><label data-price-label>Цена, ScRl</label><input name="price" type="number" min="1" max="1000000" step="1" value="' + esc(price) + '" placeholder="Укажите сумму" disabled></div></div>' +
    '<div class="grid grid-2"><div data-price-max-wrap hidden><label>Цена до, ScRl</label><input name="price_max" type="number" min="1" max="1000000" step="1" value="' + esc(priceMax) + '" placeholder="Верхняя граница" disabled></div>' +
    '<div><label>Желаемый срок (необязательно)</label><input name="deadline" type="datetime-local" step="60" value="' + esc(deadline) + '"><input type="hidden" name="deadline_offset" value="0"><p class="muted small">Укажите дату и время, до которых должна быть выполнена задача.</p></div></div>' +
    '<button class="btn btn-primary" type="submit">Опубликовать</button></form>' + script + '</section>';
}

function pageBoard(res, user, url, kind) {
  if (user.role !== 'student') return redirect(res, '/');
  const isDemand = kind === 'demand';
  const collection = isDemand ? state.demand_posts : state.offer_posts;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const category = url.searchParams.get('category') || '';
  const posts = collection
    .filter(p => (p.status === 'active' || p.status === 'pending') &&
      (p.status === 'active' || p.user_id === user.id) &&
      (p.user_id === user.id || !state.users.find(owner => owner.id === p.user_id)?.is_blocked) &&
      (!q || (p.title + ' ' + p.description).toLowerCase().includes(q)) &&
      (!category || p.category === category))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const categories = Array.from(new Set(collection.map(p => p.category).filter(Boolean))).sort();
  const cards = posts.map(post => {
    const author = state.users.find(u => u.id === post.user_id);
    const mine = post.user_id === user.id;
    const responses = state.applications.filter(a => a.post_id === post.id && a.post_kind === kind).length;
    const favorite = state.favorites.some(f => f.user_id === user.id && f.post_id === post.id && f.post_kind === kind);
    const moderation = post.status === 'pending' ? '<span class="badge badge-accent">На проверке</span>' : '';
    const responseForm = mine ? '<a class="btn btn-ghost btn-sm" href="/activity">Отклики (' + responses + ')</a>' :
      '<form method="POST" action="/posts/respond" class="mt-1">' +
      '<input type="hidden" name="post_id" value="' + esc(post.id) + '">' +
      '<input type="hidden" name="post_kind" value="' + kind + '">' +
      '<label>Моё предложение</label><textarea name="message" rows="2" maxlength="700" required placeholder="Коротко опишите, как вы можете помочь"></textarea>' +
      '<div class="grid grid-2"><div><label>Формат</label><select name="proposal_type"><option value="paid">За ScRl</option><option value="free">Бесплатно</option><option value="barter">Обмен</option></select></div>' +
      '<div><label>Цена, ScRl (для платного варианта)</label><input name="proposed_price" type="number" min="1" placeholder="Цена"></div></div>' +
      '<button class="btn btn-primary btn-sm" type="submit">Откликнуться</button></form>';
    return '<article class="card">' +
      '<div class="row-between"><div><span class="badge badge-primary-soft">' + esc(post.category) + '</span> ' + moderation + '</div><span class="muted small">' + new Date(post.created_at).toLocaleDateString('ru-RU') + '</span></div>' +
      '<h2 class="mt-1">' + esc(post.title) + '</h2>' +
      '<p>' + esc(post.description).replace(/\n/g, '<br>') + '</p>' +
      '<div class="row-between mt-1"><span class="accent"><b>' + esc(moneyLabel(post)) + '</b></span><span class="muted small">' + esc(author ? author.full_name : 'Пользователь') + (author && author.class_name ? ' · ' + esc(author.class_name) : '') + '</span></div>' +
      (post.deadline ? '<div class="muted small mt-1">Желаемый срок: ' + esc(post.deadline) + '</div>' : '') +
      '<div class="row mt-2">' + responseForm +
      '<form method="POST" action="/favorites/toggle"><input type="hidden" name="post_id" value="' + esc(post.id) + '"><input type="hidden" name="post_kind" value="' + kind + '"><button class="btn btn-ghost btn-sm">' + (favorite ? '★ В избранном' : '☆ В избранное') + '</button></form>' +
      (!mine ? '<details class="mt-1"><summary class="btn btn-ghost btn-sm" style="cursor:pointer">Пожаловаться</summary><form method="POST" action="/posts/report" class="mt-1"><input type="hidden" name="post_id" value="' + esc(post.id) + '"><input type="hidden" name="post_kind" value="' + kind + '"><label>Причина жалобы</label><select name="reason_code" required><option value="unsafe">Опасный товар или услуга</option><option value="privacy">Личные или платёжные данные</option><option value="harassment">Оскорбления или угрозы</option><option value="spam">Спам или обман</option><option value="academic">Недобросовестная учёба</option><option value="other">Другое</option></select><label>Дополнительные детали (необязательно)</label><textarea name="details" maxlength="300" rows="2" placeholder="Опишите, что именно вызывает опасение"></textarea><button class="btn btn-ghost btn-sm" type="submit">Отправить жалобу</button></form></details>' : '') +
      '</div></article>';
  }).join('');
  const action = isDemand ? '/demand/create' : '/offers/create';
  const heading = isDemand ? 'Доска спроса' : 'Доска предложений';
  const description = isDemand ? 'Опишите, что вам нужно, — другие ученики смогут откликнуться.' : 'Расскажите, что вы умеете и чем готовы поделиться.';
  const options = Object.keys(PRICE_MODES).map(key => '<option value="' + key + '">' + PRICE_MODES[key] + '</option>').join('');
  const form = '<section class="card"><h2>' + (isDemand ? 'Создать запрос' : 'Создать предложение') + '</h2><p class="muted small">' + description + '</p>' +
    '<form method="POST" action="' + action + '" class="mt-1"><label>Название</label><input name="title" maxlength="100" required placeholder="' + (isDemand ? 'Например: нужна помощь с Python' : 'Например: помогу с Python') + '">' +
    '<label>Описание</label><textarea name="description" rows="3" maxlength="1500" required></textarea>' +
    '<div class="grid grid-2"><div><label>Категория</label><input name="category" maxlength="40" required list="scrl-categories" placeholder="Программирование, языки..."><datalist id="scrl-categories">' + categories.map(c => '<option value="' + esc(c) + '">').join('') + '<option value="Учёба"><option value="Дизайн"><option value="Разработка"><option value="Творчество"><option value="Помощь"></datalist></div>' +
    '<div><label>Условия</label><select name="price_mode">' + options + '</select></div></div>' +
    '<div class="grid grid-2"><div><label>Цена / от, ScRl</label><input name="price" type="number" min="0" value="0"></div><div><label>До, ScRl (для диапазона)</label><input name="price_max" type="number" min="0" value="0"></div></div>' +
    '<label>Желаемый срок (необязательно)</label><input name="deadline" type="date">' +
    '<button class="btn btn-primary" type="submit">Опубликовать</button></form></section>';
  sendHtml(res, layout(heading, user,
    flashBox(url) + '<div class="row-between"><div><h1>' + heading + '</h1><p class="muted">ScRl · Сообщество навыков и взаимопомощи</p></div><a class="btn btn-ghost btn-sm" href="/activity">Мои отклики</a></div>' +
    form + '<section class="card"><form method="GET" action="' + (isDemand ? '/demand' : '/offers') + '" class="grid grid-2"><div><label>Поиск</label><input name="q" value="' + esc(q) + '" placeholder="Название или описание"></div><div><label>Категория</label><select name="category"><option value="">Все категории</option>' + categories.map(c => '<option ' + (category === c ? 'selected' : '') + ' value="' + esc(c) + '">' + esc(c) + '</option>').join('') + '</select></div><button class="btn btn-ghost btn-sm">Применить фильтры</button></form></section>' +
    (cards || '<div class="card text-center"><h2>Пока нет публикаций</h2><p class="muted">Создайте первую публикацию или измените параметры поиска.</p></div>')
  ));
}


function renderResponseForm(post) {
  const isDemand = post.post_kind === 'demand';
  const mode = PRICE_MODES[post.price_mode] ? post.price_mode : 'negotiable';
  const priceInput = ['range', 'negotiable'].includes(mode)
    ? '<label>' + (mode === 'range' ? 'Выберите цену в указанном диапазоне, ScRl' : 'Предложите цену, ScRl') + '</label>' +
      '<input name="proposed_price" type="number" min="' + (mode === 'range' ? Number(post.price_min || 1) : 1) +
      '" max="' + (mode === 'range' ? Number(post.price_max || 1000000) : 1000000) +
      '" step="1" required placeholder="' + (mode === 'range' ? 'От ' + Number(post.price_min || 1) + ' до ' + Number(post.price_max || 1) : 'Ваша цена') + '">'
    : '<p class="muted small mt-1">' +
      (mode === 'fixed' ? 'Цена зафиксирована автором публикации: ' + Number(post.price || 0) + ' ScRl.' :
        mode === 'free' ? 'Автор предлагает помощь бесплатно.' : 'Автор предлагает обмен услугами.') +
      '</p>';
  const label = isDemand ? 'Чем вы можете помочь?' : 'Какая помощь вам нужна?';
  const placeholder = isDemand
    ? 'Опишите, как вы поможете решить запрос автора.'
    : 'Опишите, какая именно помощь вам нужна и что требуется сделать.';
  return '<form method="POST" action="/posts/respond" class="mt-1">' +
    '<input type="hidden" name="post_id" value="' + esc(post.id) + '">' +
    '<input type="hidden" name="post_kind" value="' + post.post_kind + '">' +
    '<label>' + label + '</label><textarea name="message" rows="3" maxlength="700" required placeholder="' + placeholder + '"></textarea>' +
    priceInput +
    '<button class="btn btn-primary btn-sm" type="submit">' + (isDemand ? 'Предложить помощь' : 'Запросить помощь') + '</button></form>';
}

function recommendedHelpOffers(user) {
  const normalize = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
  const requests = state.demand_posts.filter(post =>
    post.user_id === user.id && post.status === 'active' && normalize(post.category)
  );
  if (!requests.length) return [];

  const offers = state.offer_posts.filter(post => {
    if (post.status !== 'active' || post.user_id === user.id) return false;
    const author = state.users.find(person => person.id === post.user_id);
    if (!author || author.is_blocked) return false;
    return post.price_mode === 'free' || (canTrade(user) && canTrade(author));
  });

  const matches = [];
  const used = new Set();
  for (const request of requests) {
    const category = normalize(request.category);
    for (const offer of offers) {
      if (used.has(offer.id) || normalize(offer.category) !== category) continue;
      const author = state.users.find(person => person.id === offer.user_id);
      matches.push({ offer, request, author });
      used.add(offer.id);
    }
  }
  return matches.sort((a, b) =>
    Number(a.offer.price_mode !== 'free') - Number(b.offer.price_mode !== 'free') ||
    b.offer.created_at.localeCompare(a.offer.created_at)
  ).slice(0, 3);
}

function pageCommunity(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const category = url.searchParams.get('category') || '';
  const kindFilter = ['demand', 'offer'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'all';
  const allPosts = [
    ...state.demand_posts.map(post => ({ ...post, post_kind: 'demand' })),
    ...state.offer_posts.map(post => ({ ...post, post_kind: 'offer' }))
  ];
  const categories = Array.from(new Set(allPosts.map(post => post.category).filter(Boolean))).sort();
  const posts = allPosts.filter(post => {
    const owner = state.users.find(person => person.id === post.user_id);
    return ['active', 'pending'].includes(post.status) &&
      (post.status === 'active' || post.user_id === user.id) &&
      (post.user_id === user.id || !owner?.is_blocked) &&
      (kindFilter === 'all' || post.post_kind === kindFilter) &&
      (!q || (post.title + ' ' + post.description).toLowerCase().includes(q)) &&
      (!category || post.category === category);
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const cards = posts.map(post => {
    const author = state.users.find(person => person.id === post.user_id);
    const mine = post.user_id === user.id;
    const responses = state.applications.filter(app => app.post_id === post.id && app.post_kind === post.post_kind).length;
    const favorite = state.favorites.some(item => item.user_id === user.id && item.post_id === post.id && item.post_kind === post.post_kind);
    const kindLabel = post.post_kind === 'demand' ? 'Ищу помощь' : 'Предлагаю помощь';
    const moderation = post.status === 'pending' ? '<span class="badge badge-accent">На проверке</span>' : '';
    const responseForm = mine
      ? '<a class="btn btn-ghost btn-sm" href="/activity">Отклики (' + responses + ')</a>'
      : (post.price_mode === 'free' || (canTrade(user) && canTrade(author))
        ? renderResponseForm(post)
        : '<p class="muted small">Платные условия и обмен доступны участникам с 14 лет.</p>');
    const reportForm = !mine
      ? '<details class="mt-1"><summary class="small muted" style="cursor:pointer">Пожаловаться</summary><form method="POST" action="/posts/report" class="mt-1">' +
        '<input type="hidden" name="post_id" value="' + esc(post.id) + '"><input type="hidden" name="post_kind" value="' + post.post_kind + '">' +
        '<label>Причина</label><select name="reason_code"><option value="unsafe">Опасная услуга или товар</option><option value="privacy">Личные данные</option><option value="harassment">Оскорбления или угрозы</option><option value="spam">Спам или обман</option><option value="other">Другое</option></select>' +
        '<textarea name="details" maxlength="300" rows="2" placeholder="Дополнительные детали"></textarea><button class="btn btn-ghost btn-sm">Отправить жалобу</button></form></details>'
      : '';
    return '<article class="card">' +
      '<div class="row-between"><div class="row"><span class="badge badge-primary-soft">' + kindLabel + '</span><span class="badge badge-muted">' + esc(post.category || 'Другое') + '</span>' + moderation + '</div><span class="muted small">' + new Date(post.created_at).toLocaleDateString('ru-RU') + '</span></div>' +
      '<h2 class="mt-1">' + esc(post.title) + '</h2><p>' + esc(post.description).replace(/\n/g, '<br>') + '</p>' +
      '<div class="row-between mt-1"><b class="accent">' + esc(moneyLabel(post)) + '</b><span class="muted small">' + esc(author ? author.full_name : 'Участник') + (author && author.class_name ? ' · ' + esc(author.class_name) : '') + '</span></div>' +
      (post.deadline ? '<p class="muted small mt-1">Выполнить до: ' + deadlineMarkup(post.deadline) + '</p>' : '') +
      '<div class="row mt-2">' + responseForm +
      '<form method="POST" action="/favorites/toggle"><input type="hidden" name="post_id" value="' + esc(post.id) + '"><input type="hidden" name="post_kind" value="' + post.post_kind + '"><button class="btn btn-ghost btn-sm">' + (favorite ? '★ В избранном' : '☆ В избранное') + '</button></form>' +
      reportForm + '</div></article>';
  }).join('');

  const form = renderBoardPostForm(categories, { force_free: !canTrade(user), price_mode: canTrade(user) ? 'negotiable' : 'free' });
  const filters = '<section class="card"><form method="GET" action="/board"><div class="grid grid-3">' +
    '<div><label>Поиск</label><input name="q" value="' + esc(q) + '" placeholder="Название или описание"></div>' +
    '<div><label>Показывать</label><select name="kind"><option value="all"' + (kindFilter === 'all' ? ' selected' : '') + '>Всё вместе</option><option value="demand"' + (kindFilter === 'demand' ? ' selected' : '') + '>Мне нужно</option><option value="offer"' + (kindFilter === 'offer' ? ' selected' : '') + '>Я могу</option></select></div>' +
    '<div><label>Категория</label><select name="category"><option value="">Все категории</option>' + categories.map(value => '<option value="' + esc(value) + '"' + (category === value ? ' selected' : '') + '>' + esc(value) + '</option>').join('') + '</select></div></div><button class="btn btn-ghost btn-sm mt-1" type="submit">Применить</button> <a class="btn btn-ghost btn-sm" href="/board">Сбросить</a></form></section>';
  const deadlineDisplayScript = '<script>' +
    'document.querySelectorAll("[data-deadline-utc]").forEach(function(el){const date=new Date(el.dataset.deadlineUtc);if(!Number.isNaN(date.getTime()))el.textContent=date.toLocaleString("ru-RU",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"});});' +
    'document.querySelectorAll("[data-deadline-date]").forEach(function(el){const p=el.dataset.deadlineDate.split("-").map(Number);const date=new Date(p[0],p[1]-1,p[2],12,0,0);if(!Number.isNaN(date.getTime()))el.textContent=date.toLocaleDateString("ru-RU",{day:"2-digit",month:"long",year:"numeric"});});' +
    '</script>';
  const recommendations = recommendedHelpOffers(user).map(match =>
    '<article class="card"><div class="row-between"><span class="badge badge-success">Подходит к вашему запросу</span><span class="badge badge-muted">' + esc(match.offer.category) + '</span></div>' +
    '<p class="muted small mt-1">По запросу: ' + esc(match.request.title) + '</p>' +
    '<h3 class="mt-1">' + esc(match.offer.title) + '</h3><p>' + esc(match.offer.description).replace(/\\n/g, '<br>') + '</p>' +
    '<div class="row-between mt-1"><b>' + esc(moneyLabel(match.offer)) + '</b><span class="muted small">' + esc(match.author.full_name) + (match.author.class_name ? ' · ' + esc(match.author.class_name) : '') + '</span></div>' +
    renderResponseForm({ ...match.offer, post_kind: 'offer' }) +
    '</article>'
  ).join('');
  const recommendationSection = recommendations
    ? '<section class="mt-2"><div class="row-between"><div><h2>Возможно, вам уже могут помочь</h2><p class="muted small">Подобраны активные предложения в категориях ваших запросов. Бесплатные варианты показываются первыми.</p></div></div>' + recommendations + '</section>'
    : '';
  sendHtml(res, layout('Общая доска', user,
    flashBox(url) + '<div class="row-between"><div><h1>Общая доска</h1><p class="muted">Все запросы и предложения в одной ленте.</p></div><span class="badge badge-muted">' + posts.length + ' публикаций</span></div>' +
    recommendationSection + form + filters + (cards || '<div class="card text-center"><h2>Публикаций пока нет</h2><p class="muted">Измените фильтры или создайте первую публикацию.</p></div>') + deadlineDisplayScript
  ));
}

function handleCreateBoard(res, user, params) {
  const kind = params.get('post_kind') === 'offer' ? 'offer' : 'demand';
  return createPost(res, user, params, kind);
}

function pageDemand(res, user, url) { return pageBoard(res, user, url, 'demand'); }
function pageOffers(res, user, url) { return pageBoard(res, user, url, 'offer'); }

function renderPostValidationError(res, user, initial, message) {
  const categories = Array.from(new Set([
    ...state.demand_posts.map(post => post.category),
    ...state.offer_posts.map(post => post.category)
  ].filter(Boolean))).sort();
  const content = '<div class="row-between"><div><h1>Новая публикация</h1><p class="muted">Проверьте данные — введённый текст сохранён.</p></div><a class="btn btn-ghost btn-sm" href="/board">На доску</a></div>' +
    renderBoardPostForm(categories, initial, message);
  return sendHtml(res, layout('Проверка публикации', user, content), 422);
}

async function createPost(res, user, params, kind) {
  if (user.role !== 'student') return redirect(res, '/');
  const selectedKind = params.get('post_kind') === 'offer' ? 'offer' : (kind === 'offer' ? 'offer' : 'demand');
  const title = (params.get('title') || '').trim().slice(0, 100);
  const description = (params.get('description') || '').trim().slice(0, 1500);
  const category = (params.get('category') || '').trim().slice(0, 40);
  const mode = PRICE_MODES[params.get('price_mode')] ? params.get('price_mode') : 'negotiable';
  let price = Number(params.get('price') || 0);
  let priceMax = Number(params.get('price_max') || 0);
  const deadlineInput = (params.get('deadline') || '').trim();
  const deadlineResult = parseDeadline(deadlineInput, params.get('deadline_offset') || '0');
  const initial = {
    post_kind: selectedKind, title, description, category,
    price_mode: mode,
    price: params.get('price') || '',
    price_max: params.get('price_max') || '',
    deadline: deadlineInput,
    force_free: !canTrade(user)
  };

  if (mode !== 'free' && !canTrade(user)) {
    initial.price_mode = 'free';
    return renderPostValidationError(res, user, initial, 'Платные публикации и обмен доступны с 14 лет. Выберите условие «Бесплатно».');
  }
  if (!title || !description || !category) {
    return renderPostValidationError(res, user, initial, 'Заполните название, категорию и описание публикации.');
  }
  if (['fixed', 'range'].includes(mode) &&
      (!Number.isSafeInteger(price) || price < 1 || price > 1000000)) {
    return renderPostValidationError(res, user, initial, 'Укажите целую цену от 1 до 1 000 000 ScRl.');
  }
  if (mode === 'range' &&
      (!Number.isSafeInteger(priceMax) || priceMax < price || priceMax > 1000000)) {
    return renderPostValidationError(res, user, initial, 'Верхняя граница должна быть целым числом и не меньше нижней границы.');
  }
  if (deadlineInput && !deadlineResult.ok) {
    return renderPostValidationError(res, user, initial, 'Выберите корректные дату и время в будущем. Значение не должно быть раньше текущего времени.');
  }
  if (!['fixed', 'range'].includes(mode)) { price = 0; priceMax = 0; }
  if (mode === 'fixed') priceMax = 0;

  const moderation = await analyseSubmission(title + '\n' + description + '\n' + category);
  const now = new Date().toISOString();
  const post = {
    id: crypto.randomUUID(), user_id: user.id, title, description, category,
    price_mode: mode, price, price_min: mode === 'range' ? price : null,
    price_max: mode === 'range' ? priceMax : null,
    deadline: deadlineResult.value,
    status: moderation.requiresReview ? 'pending' : 'active',
    moderation_level: moderation.level, moderation_findings: moderation.findings,
    created_at: now, updated_at: now
  };
  const target = selectedKind === 'demand' ? state.demand_posts : state.offer_posts;
  target.unshift(post);
  if (moderation.level !== 'low') {
    state.moderation_cases.unshift({
      id: crypto.randomUUID(), kind: 'post', post_kind: selectedKind, target_id: post.id,
      status: 'open', reason: moderation.findings.map(x => x.label).join('; '),
      recommendation: moderation.recommendation, created_at: now
    });
  }
  save();
  if (post.status === 'pending') {
    state.users.filter(admin => admin.role === 'admin').forEach(admin =>
      notify(admin.id, 'moderation', 'Новая публикация на проверке', 'Требуется проверка публикации «' + post.title + '».', '/admin/moderation')
    );
    return redirect(res, '/board?msg=pending_review');
  }
  return redirect(res, '/board?msg=created');
}


async function handleCreateDemand(res, user, params) { return createPost(res, user, params, 'demand'); }
async function handleCreateOffer(res, user, params) { return createPost(res, user, params, 'offer'); }

function handleRespond(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const postId = params.get('post_id');
  const kind = params.get('post_kind') === 'offer' ? 'offer' : 'demand';
  const collection = kind === 'demand' ? state.demand_posts : state.offer_posts;
  const post = collection.find(item => item.id === postId && item.status === 'active');
  const postOwner = post && state.users.find(item => item.id === post.user_id);
  const message = (params.get('message') || '').trim().slice(0, 700);
  if (!post || !postOwner || postOwner.is_blocked || post.user_id === user.id || !message) {
    return redirect(res, '/board?kind=' + kind + '&error=bad');
  }

  // The publisher sets the contract type; the respondent only describes the request
  // and, where necessary, proposes a price inside the published rules.
  const terms = resolvePostTerms(post, params.get('proposed_price'));
  if (!terms.ok) return redirect(res, '/board?kind=' + kind + '&error=' + terms.error);
  const proposalType = terms.proposalType;
  const resolvedPrice = terms.price;

  if (proposalType !== 'free' && (!canTrade(user) || !canTrade(postOwner))) {
    return redirect(res, '/activity?error=age');
  }

  if (state.applications.some(item =>
    item.post_id === postId && item.post_kind === kind &&
    item.applicant_id === user.id && item.status === 'pending'
  )) return redirect(res, '/activity?error=duplicate');

  const application = {
    id: crypto.randomUUID(), post_id: post.id, post_kind: kind,
    owner_id: post.user_id, applicant_id: user.id,
    proposal_type: proposalType, proposed_price: resolvedPrice,
    message, status: 'pending', created_at: new Date().toISOString()
  };
  state.applications.unshift(application);
  save();
  notify(post.user_id, 'application', kind === 'demand' ? 'Новый отклик на запрос' : 'Новый запрос на помощь',
    kind === 'demand' ? 'Ученик предложил помощь по вашей публикации.' : 'Ученик запросил услугу из вашей публикации.',
    '/activity');
  return redirect(res, '/activity?msg=sent');
}



function pageApplications(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const incoming = state.applications.filter(app => app.owner_id === user.id);
  const outgoing = state.applications.filter(app => app.applicant_id === user.id);
  const card = (app, received) => {
    const applicant = state.users.find(person => person.id === app.applicant_id);
    const post = (app.post_kind === 'demand' ? state.demand_posts : state.offer_posts).find(item => item.id === app.post_id);
    const canAct = received && app.status === 'pending' && post && post.status === 'active';
    const isDemand = app.post_kind === 'demand';
    const direction = received
      ? (isDemand ? 'Предложение помощи от ' : 'Запрос от ') + (applicant ? applicant.full_name : 'участника')
      : (isDemand ? 'Ваш отклик: вы предлагаете помощь' : 'Ваш запрос: вы просите помощь');
    const terms = app.proposal_type === 'paid' ? app.proposed_price + ' ScRl'
      : app.proposal_type === 'free' ? 'Бесплатно' : 'Обмен';
    return '<article class="card"><div class="row-between"><b>' + esc(post ? post.title : 'Публикация удалена') + '</b><span class="badge badge-muted">' + esc(app.status) + '</span></div>' +
      '<p class="muted small">' + direction + ' · ' + new Date(app.created_at).toLocaleString('ru-RU') + '</p>' +
      '<p class="mt-1">' + esc(app.message) + '</p><p class="mt-1"><b>' + terms + '</b></p>' +
      (canAct ? '<div class="row mt-2"><form method="POST" action="/applications/action"><input type="hidden" name="application_id" value="' + esc(app.id) + '"><input type="hidden" name="decision" value="accept"><button class="btn btn-primary btn-sm">Принять и создать сделку</button></form><form method="POST" action="/applications/action"><input type="hidden" name="application_id" value="' + esc(app.id) + '"><input type="hidden" name="decision" value="decline"><button class="btn btn-ghost btn-sm">Отклонить</button></form></div>' : '') +
      (app.deal_id ? '<a class="btn btn-ghost btn-sm mt-1" href="/deal?id=' + encodeURIComponent(app.deal_id) + '">Открыть сделку</a>' : '') + '</article>';
  };
  const deals = state.deals.filter(deal => deal.buyer_id === user.id || deal.seller_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dealCards = deals.map(deal => {
    const post = (deal.post_kind === 'demand' ? state.demand_posts : state.offer_posts).find(item => item.id === deal.post_id);
    const other = state.users.find(person => person.id === (deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id));
    const price = deal.price ? deal.price + ' ScRl' : deal.deal_type === 'barter' ? 'Обмен' : 'Бесплатно';
    return '<a class="card activity-deal" style="display:block;color:inherit" href="/deal?id=' + encodeURIComponent(deal.id) + '">' +
      '<div class="row-between"><b>' + esc(post ? post.title : 'Сделка ScRl') + '</b><span class="badge badge-muted">' + esc(deal.status) + '</span></div>' +
      '<p class="muted small mt-1">' + (deal.buyer_id === user.id ? 'Исполнитель: ' : 'Заказчик: ') + esc(other ? other.full_name : 'Участник') + '</p>' +
      '<div class="row-between mt-1"><b>' + price + '</b><span class="small">Открыть →</span></div></a>';
  }).join('');
  sendHtml(res, layout('Активность', user,
    flashBox(url) + '<div class="row-between"><div><h1>Активность</h1><p class="muted">Отклики и сделки в одном разделе.</p></div><a class="btn btn-ghost btn-sm" href="/board">На доску</a></div>' +
    '<div class="grid grid-2"><section><h2>Входящие отклики <span class="muted small">(' + incoming.length + ')</span></h2>' +
    (incoming.map(app => card(app, true)).join('') || '<p class="muted">Пока нет входящих откликов.</p>') + '</section><section><h2>Мои отклики <span class="muted small">(' + outgoing.length + ')</span></h2>' +
    (outgoing.map(app => card(app, false)).join('') || '<p class="muted">Вы ещё не отправляли отклики.</p>') + '</section></div>' +
    '<section class="mt-2" id="deals"><div class="row-between"><div><h2>Мои сделки <span class="muted small">(' + deals.length + ')</span></h2><p class="muted small">Переписка, выполнение и статусы.</p></div><a class="small" href="/deals">Все сделки →</a></div>' +
    (dealCards || '<div class="card"><p class="muted">Активных сделок пока нет. Откликнитесь на публикацию на общей доске.</p><a class="btn btn-primary btn-sm mt-1" href="/board">Открыть доску</a></div>') + '</section>'
  ));
}


function handleApplicationAction(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const app = state.applications.find(item => item.id === params.get('application_id'));
  if (!app || app.owner_id !== user.id || app.status !== 'pending') return redirect(res, '/applications?error=bad');

  if (params.get('decision') === 'decline') {
    app.status = 'declined';
    app.updated_at = new Date().toISOString();
    save();
    notify(app.applicant_id, 'application', 'Отклик отклонён', 'Автор публикации отклонил ваш отклик.', '/activity');
    return redirect(res, '/applications?msg=declined');
  }

  if (params.get('decision') !== 'accept') return redirect(res, '/applications?error=bad');
  const post = (app.post_kind === 'demand' ? state.demand_posts : state.offer_posts)
    .find(item => item.id === app.post_id);
  if (!post || post.status !== 'active') return redirect(res, '/applications?error=notfound');
  const existingDeal = state.deals.find(deal =>
    deal.post_id === post.id && deal.post_kind === app.post_kind && deal.status !== 'cancelled'
  );
  if (existingDeal) return redirect(res, '/applications?error=already_accepted');

  const buyerId = app.post_kind === 'demand' ? post.user_id : app.applicant_id;
  const sellerId = app.post_kind === 'demand' ? app.applicant_id : post.user_id;
  const price = app.proposal_type === 'paid' ? Number(app.proposed_price) : 0;
  const buyer = state.users.find(item => item.id === buyerId);
  const seller = state.users.find(item => item.id === sellerId);
  if (!buyer || !seller || (app.proposal_type !== 'free' && (!canTrade(buyer) || !canTrade(seller)))) {
    return redirect(res, '/applications?error=age');
  }
  if (!Number.isSafeInteger(price) || price < 0 || price > 1000000) {
    return redirect(res, '/applications?error=amount');
  }
  if (price > 0 && balance(buyerId, 'available') < price) {
    return redirect(res, '/applications?error=insufficient');
  }

  const now = new Date().toISOString();
  const commissionPercent = Math.min(100, Math.max(0, Number(state.settings.marketplace_commission_percent) || 0));
  const deal = {
    id: crypto.randomUUID(), post_id: post.id, post_kind: app.post_kind,
    application_id: app.id, buyer_id: buyerId, seller_id: sellerId,
    created_by: user.id, deal_type: app.proposal_type, price,
    status: 'accepted', commission_percent: commissionPercent,
    created_at: now, delivered_at: null, completed_at: null
  };
  const previousApp = { status: app.status, deal_id: app.deal_id, updated_at: app.updated_at };
  const previousPost = { status: post.status, updated_at: post.updated_at };
  const systemMessage = {
    id: crypto.randomUUID(), deal_id: deal.id, sender_id: user.id,
    message: 'Условия приняты. Сделка создана.', created_at: now, system: true
  };

  state.deals.unshift(deal);
  post.status = 'in_progress';
  post.updated_at = now;
  app.status = 'accepted';
  app.deal_id = deal.id;
  app.updated_at = now;
  state.deal_messages.push(systemMessage);

  try {
    if (price > 0) {
      recordTx('deal_escrow', buyerId, { dealId: deal.id, amount: price }, [
        { accountId: account(buyerId, 'available').id, amount: -price, note: 'Резервирование сделки' },
        { accountId: account(buyerId, 'held').id, amount: price, note: 'Escrow сделки ' + deal.id }
      ]);
    } else {
      save();
    }
  } catch (error) {
    state.deals = state.deals.filter(item => item.id !== deal.id);
    state.deal_messages = state.deal_messages.filter(item => item.id !== systemMessage.id);
    app.status = previousApp.status;
    if (previousApp.deal_id === undefined) delete app.deal_id;
    else app.deal_id = previousApp.deal_id;
    app.updated_at = previousApp.updated_at;
    post.status = previousPost.status;
    post.updated_at = previousPost.updated_at;
    save();
    console.error('Deal creation failed:', error.message);
    return redirect(res, '/applications?error=escrow');
  }

  notify(app.applicant_id, 'deal', 'Отклик принят', 'Создана сделка. Откройте её, чтобы продолжить.', '/deal?id=' + deal.id);
  notify(post.user_id, 'deal', 'Сделка создана', 'Можно продолжить работу в переписке сделки.', '/deal?id=' + deal.id);
  return redirect(res, '/deal?id=' + deal.id);
}


function pageDeals(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const deals = state.deals.filter(d => d.buyer_id === user.id || d.seller_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const cards = deals.map(d => {
    const post = (d.post_kind === 'demand' ? state.demand_posts : state.offer_posts).find(p => p.id === d.post_id);
    const other = state.users.find(u => u.id === (d.buyer_id === user.id ? d.seller_id : d.buyer_id));
    return '<a class="card" style="display:block;color:inherit" href="/deal?id=' + encodeURIComponent(d.id) + '"><div class="row-between"><b>' + esc(post ? post.title : 'Сделка ScRl') + '</b><span class="badge badge-muted">' + esc(d.status) + '</span></div><p class="muted small mt-1">' + (d.buyer_id === user.id ? 'Исполнитель: ' : 'Заказчик: ') + esc(other ? other.full_name : '') + '</p><div class="row-between mt-1"><b>' + (d.price ? d.price + ' ScRl' : d.deal_type === 'barter' ? 'Обмен' : 'Бесплатно') + '</b><span class="muted small">Открыть сделку →</span></div></a>';
  }).join('');
  sendHtml(res, layout('Мои сделки', user, flashBox(url) + '<h1>Мои сделки</h1>' + (cards || '<div class="card"><p class="muted">У вас пока нет сделок. Найдите публикацию на доске спроса или предложений и отправьте отклик.</p><div class="row mt-2"><a class="btn btn-primary" href="/board">Общая доска</a><a class="btn btn-ghost" href="/board">Общая доска</a></div></div>')));
}

function pageDeal(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const deal = state.deals.find(d => d.id === url.searchParams.get('id'));
  if (!deal || (deal.buyer_id !== user.id && deal.seller_id !== user.id)) return redirect(res, '/deals?error=notfound');
  const isBuyer = deal.buyer_id === user.id;
  const post = (deal.post_kind === 'demand' ? state.demand_posts : state.offer_posts).find(p => p.id === deal.post_id);
  const messages = state.deal_messages.filter(m => m.deal_id === deal.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(m => {
    const sender = state.users.find(u => u.id === m.sender_id);
    return '<div class="card" style="padding:12px;margin-bottom:8px"><div class="row-between"><b>' + (m.system ? 'ScRl' : esc(sender ? sender.full_name : 'Участник')) + '</b><span class="muted small">' + new Date(m.created_at).toLocaleString('ru-RU') + '</span></div><p class="mt-1">' + esc(m.message).replace(/\n/g, '<br>') + '</p></div>';
  }).join('');
  let actions = '';
  if (deal.status === 'accepted' || deal.status === 'in_progress') {
    if (!isBuyer) actions += '<form method="POST" action="/deals/deliver"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><button class="btn btn-primary">Отметить выполнение</button></form>';
    if (isBuyer && deal.status === 'in_progress') actions += '<form method="POST" action="/deals/confirm"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><button class="btn btn-primary">Подтвердить и завершить</button></form>';
    actions += '<form method="POST" action="/deals/dispute"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><input name="reason" required maxlength="500" placeholder="Причина спора"><button class="btn btn-ghost">Открыть спор</button></form>';
    actions += '<form method="POST" action="/deals/cancel"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><button class="btn btn-ghost">Отменить до выполнения</button></form>';
  } else if (deal.status === 'awaiting_confirmation' && isBuyer) {
    actions = '<form method="POST" action="/deals/confirm"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><button class="btn btn-primary">Подтвердить и завершить</button></form><form method="POST" action="/deals/dispute"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><input name="reason" required maxlength="500" placeholder="Причина спора"><button class="btn btn-ghost">Открыть спор</button></form>';
  }
  const review = deal.status === 'completed' && !state.reviews.some(r => r.deal_id === deal.id && r.reviewer_id === user.id)
    ? '<section class="card"><h2>Оставить отзыв</h2><form method="POST" action="/deals/review"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><label>Оценка</label><select name="rating"><option value="5">5 — Отлично</option><option value="4">4 — Хорошо</option><option value="3">3 — Нормально</option><option value="2">2 — Плохо</option><option value="1">1 — Очень плохо</option></select><label>Комментарий</label><textarea name="comment" maxlength="500" rows="2"></textarea><button class="btn btn-primary">Опубликовать отзыв</button></form></section>' : '';
  sendHtml(res, layout('Сделка', user, flashBox(url) + '<div class="row-between"><div><h1>' + esc(post ? post.title : 'Сделка') + '</h1><p class="muted">Статус: ' + esc(deal.status) + ' · ' + (deal.price ? deal.price + ' ScRl в escrow' : deal.deal_type === 'barter' ? 'Обмен без денежных расчётов' : 'Бесплатная сделка') + '</p></div><a class="btn btn-ghost btn-sm" href="/deals">Все сделки</a></div>' +
    '<section class="card"><h2>Переписка и условия</h2>' + (messages || '<p class="muted">Сообщений пока нет.</p>') +
    (['completed', 'disputed', 'cancelled'].includes(deal.status) ? '' : '<form method="POST" action="/deals/message"><input type="hidden" name="deal_id" value="' + esc(deal.id) + '"><textarea name="message" rows="3" maxlength="1000" required placeholder="Сообщение участнику"></textarea><button class="btn btn-primary">Отправить сообщение</button></form>') +
    '<div class="row mt-2">' + actions + '</div></section>' + review));
}

function handleDealMessage(res, user, params) {
  const deal = state.deals.find(d => d.id === params.get('deal_id'));
  const message = (params.get('message') || '').trim().slice(0, 1000);
  if (!deal || ![deal.buyer_id, deal.seller_id].includes(user.id) || !message || ['completed', 'cancelled'].includes(deal.status)) return redirect(res, '/deals?error=bad');
  state.deal_messages.push({ id: crypto.randomUUID(), deal_id: deal.id, sender_id: user.id, message, created_at: new Date().toISOString() });
  save();
  const other = deal.buyer_id === user.id ? deal.seller_id : deal.buyer_id;
  notify(other, 'message', 'Новое сообщение по сделке', 'Участник отправил сообщение.', '/deal?id=' + deal.id);
  return redirect(res, '/deal?id=' + deal.id);
}

function handleDealDeliver(res, user, params) {
  const deal = state.deals.find(d => d.id === params.get('deal_id'));
  if (!deal || deal.seller_id !== user.id || !['accepted', 'in_progress'].includes(deal.status)) return redirect(res, '/deals?error=bad');
  deal.status = 'awaiting_confirmation';
  deal.delivered_at = new Date().toISOString();
  save();
  notify(deal.buyer_id, 'deal', 'Работа отмечена выполненной', 'Проверьте результат и подтвердите сделку или откройте спор.', '/deal?id=' + deal.id);
  return redirect(res, '/deal?id=' + deal.id + '&msg=delivered');
}

function handleDealConfirm(res, user, params) {
  const deal = state.deals.find(d => d.id === params.get('deal_id'));
  if (!deal || deal.buyer_id !== user.id || deal.status !== 'awaiting_confirmation') return redirect(res, '/deals?error=bad');
  const ledger = dealLedgerState(deal);
  const price = Number(deal.price || 0);
  if (!Number.isSafeInteger(price) || price < 0) return redirect(res, '/deals?error=bad');
  if (price > 0) {
    if (ledger.settlement) {
      if (!['deal_settlement', 'deal_dispute_release'].includes(ledger.settlement.kind)) {
        return redirect(res, '/deals?error=already_settled');
      }
    } else {
      if (!ledger.held || ledger.escrow !== price || ledger.held.balance < price) {
        return redirect(res, '/deals?error=escrow');
      }
      const commissionPercent = Math.min(100, Math.max(0, Number(deal.commission_percent) || 0));
      const commission = Math.floor(price * commissionPercent / 100);
      const sellerAmount = price - commission;
      const entries = [
        { accountId: ledger.held.id, amount: -price, note: 'Завершение сделки' },
        { accountId: account(deal.seller_id, 'available').id, amount: sellerAmount, note: 'Оплата по сделке' }
      ];
      if (commission > 0) {
        const burn = systemAccount('burn');
        if (!burn) return redirect(res, '/deals?error=ledger');
        entries.push({ accountId: burn.id, amount: commission, note: 'Комиссия платформы' });
      }
      try {
        recordTx('deal_settlement', user.id, { dealId: deal.id, price, commission }, entries);
      } catch (error) {
        console.error('Deal settlement failed:', error.message);
        return redirect(res, '/deals?error=settlement');
      }
    }
  }
  deal.status = 'completed';
  deal.completed_at = new Date().toISOString();
  const collection = deal.post_kind === 'demand' ? state.demand_posts : state.offer_posts;
  const post = collection.find(p => p.id === deal.post_id);
  if (post) post.status = 'completed';
  save();
  notify(deal.seller_id, 'deal', 'Сделка завершена', 'Заказчик подтвердил выполнение.', '/deal?id=' + deal.id);
  return redirect(res, '/deal?id=' + deal.id + '&msg=confirmed');
}

function handleDealCancel(res, user, params) {
  const deal = state.deals.find(d => d.id === params.get('deal_id'));
  if (!deal || ![deal.buyer_id, deal.seller_id].includes(user.id) ||
      !['accepted', 'in_progress'].includes(deal.status)) return redirect(res, '/deals?error=bad');
  const ledger = dealLedgerState(deal);
  const price = Number(deal.price || 0);
  if (!Number.isSafeInteger(price) || price < 0) return redirect(res, '/deals?error=bad');
  if (ledger.settlement && !['deal_escrow_refund', 'deal_dispute_refund'].includes(ledger.settlement.kind)) {
    return redirect(res, '/deals?error=already_settled');
  }
  if (price > 0 && !ledger.settlement) {
    if (!ledger.held || ledger.escrow !== price || ledger.held.balance < price) {
      return redirect(res, '/deals?error=escrow');
    }
    try {
      recordTx('deal_escrow_refund', user.id, { dealId: deal.id, amount: price }, [
        { accountId: ledger.held.id, amount: -price, note: 'Отмена до выполнения' },
        { accountId: account(deal.buyer_id, 'available').id, amount: price, note: 'Возврат escrow' }
      ]);
    } catch (error) {
      console.error('Deal cancellation refund failed:', error.message);
      return redirect(res, '/deals?error=refund');
    }
  }
  deal.status = 'cancelled';
  deal.cancelled_at = new Date().toISOString();
  const post = (deal.post_kind === 'demand' ? state.demand_posts : state.offer_posts).find(item => item.id === deal.post_id);
  if (post && post.status === 'in_progress') { post.status = 'active'; post.updated_at = new Date().toISOString(); }
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: user.id, action: 'deal_cancelled',
    target_id: deal.id, reason: 'Cancelled before delivery', created_at: new Date().toISOString()
  });
  save();
  notify(deal.buyer_id, 'deal', 'Сделка отменена', 'Сделка отменена до выполнения. Зарезервированные ScRl возвращены.', '/deals');
  notify(deal.seller_id, 'deal', 'Сделка отменена', 'Сделка отменена до выполнения.', '/deals');
  return redirect(res, '/deal?id=' + deal.id + '&msg=cancelled');
}

function handleDealDispute(res, user, params) {
  const deal = state.deals.find(d => d.id === params.get('deal_id'));
  const reason = (params.get('reason') || '').trim().slice(0, 500);
  if (!deal || ![deal.buyer_id, deal.seller_id].includes(user.id) || !reason || !['accepted', 'in_progress', 'awaiting_confirmation'].includes(deal.status)) return redirect(res, '/deals?error=bad');
  deal.status = 'disputed';
  deal.dispute_reason = reason;
  deal.disputed_at = new Date().toISOString();
  const item = { id: crypto.randomUUID(), kind: 'deal', target_id: deal.id, status: 'open', reason, created_by: user.id, created_at: new Date().toISOString() };
  state.moderation_cases.unshift(item);
  state.admin_audit_logs.push({ id: crypto.randomUUID(), actor_id: user.id, action: 'deal_disputed', target_id: deal.id, reason, created_at: new Date().toISOString() });
  save();
  state.users.filter(u => u.role === 'admin').forEach(a => notify(a.id, 'moderation', 'Новый спор по сделке', reason, '/admin/moderation'));
  return redirect(res, '/deal?id=' + deal.id + '&msg=reported');
}

function handleDealReview(res, user, params) {
  const deal = state.deals.find(d => d.id === params.get('deal_id'));
  const rating = Math.floor(Number(params.get('rating') || 0));
  const comment = (params.get('comment') || '').trim().slice(0, 500);
  if (!deal || deal.status !== 'completed' || ![deal.buyer_id, deal.seller_id].includes(user.id) ||
      (user.id !== deal.buyer_id && user.id !== deal.seller_id) ||
      state.reviews.some(r => r.deal_id === deal.id && r.reviewer_id === user.id) || rating < 1 || rating > 5) {
    return redirect(res, '/deals?error=bad');
  }
  const review = { id: crypto.randomUUID(), deal_id: deal.id, reviewer_id: user.id, target_user_id: user.id === deal.buyer_id ? deal.seller_id : deal.buyer_id, rating, comment, created_at: new Date().toISOString() };
  state.reviews.unshift(review);
  save();
  notify(review.target_user_id, 'review', 'Новый отзыв', 'Участник оставил отзыв после завершённой сделки.', '/profile?user_id=' + review.target_user_id);
  return redirect(res, '/deal?id=' + deal.id + '&msg=reviewed');
}

function pageProfile(res, user, url) {
  const targetId = url.searchParams.get('user_id') || user.id;
  const target = state.users.find(u => u.id === targetId);
  if (!target) return redirect(res, '/?error=notfound');
  const reviews = state.reviews.filter(r => r.target_user_id === target.id);
  const average = reviews.length ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1) : '—';
  const completed = state.deals.filter(d => d.status === 'completed' && (d.buyer_id === target.id || d.seller_id === target.id)).length;
  const offers = state.offer_posts.filter(p => p.user_id === target.id && p.status === 'active');
  sendHtml(res, layout('Профиль', user, '<h1>Профиль</h1><section class="card"><div class="row-between"><div><h2>' + esc(target.full_name) + '</h2><p class="muted">' + esc(target.class_name || 'Участник ScRl') + '</p></div><span class="badge badge-primary-soft">' + esc(target.role) + '</span></div><div class="grid grid-2 mt-2"><div><div class="muted small">Рейтинг</div><h2>' + average + ' / 5</h2><p class="muted small">' + reviews.length + ' отзывов</p></div><div><div class="muted small">Завершённые сделки</div><h2>' + completed + '</h2></div></div></section><section class="card"><h2>Активные предложения</h2>' +
    (offers.map(p => '<div class="row-between"><b>' + esc(p.title) + '</b><span class="muted small">' + esc(p.category) + '</span></div>').join('<hr>') || '<p class="muted">Пока нет активных предложений.</p>') +
    '</section><section class="card"><h2>Отзывы</h2>' + (reviews.map(r => {
      const author = state.users.find(u => u.id === r.reviewer_id);
      return '<div class="row-between"><b>' + esc(author ? author.full_name : 'Участник') + '</b><span class="badge badge-accent">' + r.rating + ' / 5</span></div><p>' + esc(r.comment || 'Без комментария') + '</p><hr>';
    }).join('') || '<p class="muted">Отзывов пока нет.</p>') + '</section>'));
}

function toggleFavorite(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const postId = params.get('post_id');
  const kind = params.get('post_kind') === 'offer' ? 'offer' : 'demand';
  const collection = kind === 'offer' ? state.offer_posts : state.demand_posts;
  const post = collection.find(item => item.id === postId && item.status === 'active');
  if (!post || post.user_id === user.id && !state.favorites.some(item => item.user_id === user.id && item.post_id === postId && item.post_kind === kind)) {
    return redirect(res, kind === 'offer' ? '/offers?error=notfound' : '/demand?error=notfound');
  }
  const index = state.favorites.findIndex(f => f.user_id === user.id && f.post_id === postId && f.post_kind === kind);
  if (index >= 0) state.favorites.splice(index, 1);
  else state.favorites.push({ id: crypto.randomUUID(), user_id: user.id, post_id: postId, post_kind: kind, created_at: new Date().toISOString() });
  save();
  return redirect(res, kind === 'demand' ? '/demand' : '/offers');
}

function handlePostReport(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const postId = params.get('post_id');
  const kind = params.get('post_kind') === 'offer' ? 'offer' : 'demand';
  const collection = kind === 'demand' ? state.demand_posts : state.offer_posts;
  const post = collection.find(p => p.id === postId && p.status === 'active');
  if (!post || post.user_id === user.id) return redirect(res, kind === 'demand' ? '/demand?error=bad' : '/offers?error=bad');
  const existing = state.reports.find(r => r.target_id === post.id && r.reporter_id === user.id && r.status === 'open');
  if (existing) return redirect(res, '/notifications?msg=reported');
  const report = {
    id: crypto.randomUUID(), target_type: 'post', target_id: post.id,
    post_type: kind, reporter_id: user.id, reason: 'Жалоба на публикацию',
    status: 'open', created_at: new Date().toISOString()
  };
  state.reports.unshift(report);
  state.moderation_cases.unshift({
    id: crypto.randomUUID(), kind: 'report', target_id: post.id, post_kind: kind,
    status: 'open', reason: report.reason, reporter_id: user.id,
    created_at: new Date().toISOString()
  });
  state.users.filter(u => u.role === 'admin').forEach(admin =>
    notify(admin.id, 'moderation', 'Новая жалоба на публикацию', 'Поступила жалоба на публикацию: ' + post.title, '/admin/moderation')
  );
  save();
  return redirect(res, '/notifications?msg=reported');
}

function handleClosePost(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const kind = params.get('post_kind') === 'offer' ? 'offer' : 'demand';
  const collection = kind === 'demand' ? state.demand_posts : state.offer_posts;
  const post = collection.find(p => p.id === params.get('post_id') && p.user_id === user.id && p.status === 'active');
  if (!post) return redirect(res, kind === 'demand' ? '/demand?error=bad' : '/offers?error=bad');
  post.status = 'closed';
  post.updated_at = new Date().toISOString();
  save();
  return redirect(res, kind === 'demand' ? '/demand?msg=closed' : '/offers?msg=closed');
}

function pageFavorites(res, user) {
  if (user.role !== 'student') return redirect(res, '/');
  const posts = state.favorites.filter(f => f.user_id === user.id).map(f => {
    const post = (f.post_kind === 'offer' ? state.offer_posts : state.demand_posts).find(p => p.id === f.post_id);
    return post ? { favorite: f, post } : null;
  }).filter(Boolean);
  const rows = posts.map(x => {
    const href = x.favorite.post_kind === 'offer' ? '/offers' : '/demand';
    return '<a class="card" style="display:block;color:inherit" href="' + href + '"><div class="row-between"><b>' +
      esc(x.post.title) + '</b><span class="badge badge-primary-soft">' + (x.favorite.post_kind === 'offer' ? 'Предложение' : 'Спрос') +
      '</span></div><p class="muted small mt-1">' + esc(x.post.category || 'Другое') + ' · ' + esc(moneyLabel(x.post)) +
      '</p><p class="mt-1">' + esc(x.post.description) + '</p></a>';
  }).join('');
  sendHtml(res, layout('Избранное', user, '<h1>Избранное</h1>' + (rows || '<div class="card"><p class="muted">Сохранённых публикаций пока нет.</p><a class="btn btn-primary mt-1" href="/demand">Перейти к доскам</a></div>')));
}

function pageNotifications(res, user, url) {
  const items = state.notifications.filter(n => n.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  let markedRead = false;
  for (const item of items) { if (!item.is_read) { item.is_read = true; markedRead = true; } }
  if (markedRead) save();
  const rows = items.map(n => '<a class="card" style="display:block;color:inherit;opacity:' + (n.is_read ? '.72' : '1') + '" href="' + esc(n.href || '/') + '"><div class="row-between"><b>' + esc(n.title) + '</b><span class="muted small">' + new Date(n.created_at).toLocaleString('ru-RU') + '</span></div><p class="mt-1">' + esc(n.body) + '</p>' + (!n.is_read ? '<span class="badge badge-accent">Новое</span>' : '') + '</a>').join('');
  sendHtml(res, layout('Уведомления', user, flashBox(url) + '<div class="row-between"><h1>Уведомления</h1><form method="POST" action="/notifications/read"><button class="btn btn-ghost btn-sm">Отметить всё прочитанным</button></form></div>' + (rows || '<div class="card"><p class="muted">Уведомлений пока нет.</p></div>')));
}

function markNotificationsRead(res, user) {
  state.notifications.forEach(n => { if (n.user_id === user.id) n.is_read = true; });
  save();
  return redirect(res, '/notifications?msg=read');
}

module.exports = {
  pageCommunity, handleCreateBoard, pageDemand, pageOffers, handleCreateDemand, handleCreateOffer, handleRespond,
  pageApplications, handleApplicationAction, pageDeals, pageDeal, handleDealMessage,
  handleDealDeliver, handleDealConfirm, handleDealCancel, handleDealDispute, handleDealReview,
  pageProfile, toggleFavorite, pageFavorites, handlePostReport, handleClosePost,
  pageNotifications, markNotificationsRead, unreadCount
};
