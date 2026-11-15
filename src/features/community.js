const crypto = require('node:crypto');
const { state, save, account, balance, recordTx } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');

function notify(userId, type, title, message, href) {
  if (!userId) return;
  state.notifications.push({
    id: crypto.randomUUID(), user_id: userId, type, title, message,
    href: href || '/notifications', is_read: false, created_at: new Date().toISOString()
  });
}

function findPost(postId, type) {
  const source = type === 'demand' ? state.demands : state.offers;
  return source.find(x => x.id === postId);
}

function priceLabel(post) {
  if (post.price_mode === 'free') return 'Бесплатно';
  if (post.price_mode === 'barter') return 'Обмен';
  if (post.price_mode === 'negotiable') return 'Договорная цена';
  return Number(post.price || 0).toLocaleString('ru-RU') + ' ScRl';
}

function postCard(post, type, user, showApply) {
  const owner = state.users.find(x => x.id === post.user_id);
  const favorite = state.favorites.some(x => x.user_id === user.id && x.post_id === post.id && x.post_type === type);
  const applications = state.applications.filter(x => x.post_id === post.id && x.post_type === type).length;
  const action = post.user_id === user.id
    ? '<span class="badge badge-muted">Ваше объявление</span>'
    : (showApply ? '<form method="POST" action="/posts/apply" class="mt-1"><input type="hidden" name="post_id" value="' + post.id + '"><input type="hidden" name="post_type" value="' + type + '"><label>Сообщение</label><textarea name="message" rows="2" maxlength="500" required placeholder="Коротко расскажите, чем можете помочь"></textarea><label>Ваше предложение, ScRl (необязательно)</label><input name="offered_price" type="number" min="0" step="1" placeholder="Оставьте пустым, если цена не важна"><button class="btn btn-primary btn-sm">Откликнуться</button></form>' : '');
  return '<article class="card">' +
    '<div class="row-between"><div><span class="badge badge-primary-soft">' + (type === 'demand' ? 'Спрос' : 'Предложение') + '</span> <span class="badge badge-muted">' + esc(post.category || 'Другое') + '</span></div>' +
    '<span class="muted small">' + new Date(post.created_at).toLocaleDateString('ru-RU') + '</span></div>' +
    '<h2 class="mt-1">' + esc(post.title) + '</h2><p>' + esc(post.description) + '</p>' +
    '<div class="row-between mt-1"><div><b class="accent">' + priceLabel(post) + '</b><div class="muted small">' + esc(owner ? owner.full_name : 'Участник') + (owner && owner.class_name ? ' · ' + esc(owner.class_name) : '') + '</div></div>' +
    '<span class="muted small">' + applications + ' откликов</span></div>' +
    '<div class="row mt-1"><form method="POST" action="/favorites/toggle"><input type="hidden" name="post_id" value="' + post.id + '"><input type="hidden" name="post_type" value="' + type + '"><button class="btn btn-ghost btn-sm">' + (favorite ? 'Убрать из избранного' : 'В избранное') + '</button></form>' +
    (post.user_id !== user.id ? '<form method="POST" action="/reports/create"><input type="hidden" name="target_type" value="post"><input type="hidden" name="target_id" value="' + post.id + '"><input type="hidden" name="post_type" value="' + type + '"><input name="reason" required maxlength="240" placeholder="Причина жалобы" style="width:170px;margin:0"><button class="btn btn-ghost btn-sm">Пожаловаться</button></form>' : '') + '</div>' +
    action + '</article>';
}

function pageBoard(res, user, url, type) {
  if (user.role !== 'student') return redirect(res, user.role === 'admin' ? '/admin' : '/teacher');
  const isDemand = type === 'demand';
  const data = isDemand ? state.demands : state.offers;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const category = (url.searchParams.get('category') || '').trim();
  const items = data.filter(x => x.status === 'active' &&
    (!q || (x.title + ' ' + x.description).toLowerCase().includes(q)) &&
    (!category || x.category === category))
    .sort((a,b) => b.created_at.localeCompare(a.created_at));
  const own = data.filter(x => x.user_id === user.id && x.status === 'active').length;
  const categories = Array.from(new Set(data.map(x => x.category).filter(Boolean))).sort();
  const categoryOptions = '<option value="">Все категории</option>' + categories.map(x => '<option' + (category === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  const cards = items.map(x => postCard(x, type, user, true)).join('');
  const form = '<section class="card"><h2>' + (isDemand ? 'Создать запрос' : 'Создать предложение') + '</h2>' +
    '<form method="POST" action="/' + (isDemand ? 'demand' : 'offer') + '/create">' +
    '<label>Название</label><input name="title" maxlength="100" required placeholder="' + (isDemand ? 'Что вам нужно?' : 'Что вы умеете предложить?') + '">' +
    '<label>Описание</label><textarea name="description" rows="3" maxlength="1200" required></textarea>' +
    '<label>Категория</label><input name="category" maxlength="50" required placeholder="Например, программирование, языки, дизайн">' +
    '<label>Условия</label><select name="price_mode"><option value="fixed">Фиксированная цена</option><option value="negotiable">Договорная</option><option value="free">Бесплатно</option><option value="barter">Обмен</option></select>' +
    '<label>Цена ScRl (для фиксированной цены)</label><input name="price" type="number" min="0" max="100000" value="0">' +
    '<button class="btn btn-primary">Опубликовать</button></form></section>';
  sendHtml(res, layout(isDemand ? 'Доска спроса' : 'Доска предложений', user,
    flashBox(url) + '<div class="row-between"><div><h1>' + (isDemand ? 'Мне нужно' : 'Я могу') + '</h1><p class="muted">' + (isDemand ? 'Запросы школьного сообщества' : 'Навыки, помощь и услуги участников') + '</p></div><a class="btn btn-ghost" href="/marketplace">Общий каталог</a></div>' +
    '<div class="grid grid-2"><div>' + form + '</div><div>' +
    '<form method="GET" class="card"><h2>Поиск и фильтры</h2><input name="q" value="' + esc(q) + '" placeholder="Поиск по названию и описанию"><select name="category">' + categoryOptions + '</select><button class="btn btn-ghost">Применить</button> <a class="btn btn-ghost" href="/' + (isDemand ? 'demand' : 'offer') + '">Сбросить</a><p class="muted small mt-1">Ваших активных публикаций: ' + own + '</p></form></div></div>' +
    '<h2 class="mt-2">Актуальные публикации</h2>' + (cards || '<div class="card muted">Пока нет публикаций по этому фильтру.</div>')));
}

function pageMarketplace(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const type = url.searchParams.get('type') === 'demand' ? 'demand' : url.searchParams.get('type') === 'offer' ? 'offer' : 'all';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const all = (type === 'all' || type === 'demand' ? state.demands.filter(x => x.status === 'active').map(x => ({...x, post_type:'demand'})) : [])
    .concat(type === 'all' || type === 'offer' ? state.offers.filter(x => x.status === 'active').map(x => ({...x, post_type:'offer'})) : [])
    .filter(x => !q || (x.title + ' ' + x.description).toLowerCase().includes(q))
    .sort((a,b) => b.created_at.localeCompare(a.created_at));
  const cards = all.map(x => postCard(x, x.post_type, user, true)).join('');
  sendHtml(res, layout('Маркетплейс', user, flashBox(url) + '<h1>Маркетплейс ScRl</h1><p class="muted">Спрос и предложения в одном каталоге.</p>' +
    '<div class="row mt-1"><a class="btn ' + (type === 'all' ? 'btn-primary' : 'btn-ghost') + '" href="/marketplace">Всё</a><a class="btn ' + (type === 'demand' ? 'btn-primary' : 'btn-ghost') + '" href="/marketplace?type=demand">Спрос</a><a class="btn ' + (type === 'offer' ? 'btn-primary' : 'btn-ghost') + '" href="/marketplace?type=offer">Предложения</a></div>' +
    '<form method="GET" class="card mt-1"><input type="hidden" name="type" value="' + type + '"><input name="q" value="' + esc(q) + '" placeholder="Поиск по названию и описанию"><button class="btn btn-primary">Найти</button></form>' +
    (cards || '<div class="card muted">Ничего не найдено.</div>')));
}

function handleCreatePost(res, user, params, type) {
  if (user.role !== 'student') return redirect(res, '/');
  const title = (params.get('title') || '').trim();
  const description = (params.get('description') || '').trim();
  const category = (params.get('category') || 'Другое').trim().slice(0,50);
  const priceMode = params.get('price_mode') || 'negotiable';
  const price = Math.max(0, Math.min(100000, parseInt(params.get('price') || '0',10) || 0));
  if (title.length < 4 || description.length < 12 || !category) return redirect(res, '/' + type + '?error=fields');
  if (!['fixed','negotiable','free','barter'].includes(priceMode)) return redirect(res, '/' + type + '?error=bad');
  const item = {
    id: crypto.randomUUID(), user_id: user.id, title: title.slice(0,100),
    description: description.slice(0,1200), category, price_mode: priceMode,
    price: priceMode === 'fixed' ? price : 0, status: 'active',
    created_at: new Date().toISOString(), expires_at: new Date(Date.now()+30*86400000).toISOString()
  };
  (type === 'demand' ? state.demands : state.offers).push(item);
  save();
  redirect(res, '/' + type + '?msg=created');
}

function handleApply(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const type = params.get('post_type');
  const post = findPost(params.get('post_id'), type);
  const message = (params.get('message') || '').trim();
  const rawPrice = (params.get('offered_price') || '').trim();
  const offeredPrice = rawPrice === '' ? null : Number(rawPrice);
  if (!post || post.status !== 'active' || post.user_id === user.id || message.length < 4 ||
      (offeredPrice !== null && (!Number.isSafeInteger(offeredPrice) || offeredPrice < 0 || offeredPrice > 100000))) {
    return redirect(res, '/marketplace?error=bad');
  }
  if (state.applications.some(x => x.post_id === post.id && x.post_type === type && x.user_id === user.id && x.status === 'pending')) {
    return redirect(res, '/applications?error=bad');
  }
  const app = { id: crypto.randomUUID(), post_id: post.id, post_type: type, user_id: user.id,
    message: message.slice(0,500), offered_price: offeredPrice, status: 'pending', created_at: new Date().toISOString() };
  state.applications.push(app);
  notify(post.user_id, 'application', 'Новый отклик', user.full_name + ' откликнулся на публикацию «' + post.title + '».', '/applications');
  save();
  redirect(res, '/applications?msg=created');
}

function pageApplications(res, user, url) {
  const incoming = state.applications.filter(a => {
    const p = findPost(a.post_id,a.post_type); return p && p.user_id === user.id;
  }).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const outgoing = state.applications.filter(a=>a.user_id===user.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const render = (a, isIncoming) => {
    const p=findPost(a.post_id,a.post_type); const author=state.users.find(x=>x.id===a.user_id);
    const controls = isIncoming && a.status==='pending'
      ? '<div class="row mt-1"><form method="POST" action="/applications/decision"><input type="hidden" name="application_id" value="'+a.id+'"><input type="hidden" name="decision" value="accept"><button class="btn btn-primary btn-sm">Принять</button></form><form method="POST" action="/applications/decision"><input type="hidden" name="application_id" value="'+a.id+'"><input type="hidden" name="decision" value="reject"><button class="btn btn-ghost btn-sm">Отклонить</button></form></div>' : '';
    return '<div class="card"><div class="row-between"><b>'+esc(p?p.title:'Публикация удалена')+'</b><span class="badge badge-muted">'+esc(a.status)+'</span></div><p class="mt-1">'+esc(a.message)+'</p><p class="muted small">'+(isIncoming?'От: '+esc(author?author.full_name:'Участник'):'Ваш отклик')+' · Предложение: '+(a.offered_price===null?'не указано':a.offered_price+' ScRl')+'</p>'+controls+'</div>';
  };
  sendHtml(res,layout('Отклики',user,flashBox(url)+'<h1>Отклики</h1><h2>Входящие</h2>'+(incoming.map(a=>render(a,true)).join('')||'<p class="muted">Входящих откликов пока нет.</p>')+'<h2 class="mt-2">Мои отклики</h2>'+(outgoing.map(a=>render(a,false)).join('')||'<p class="muted">Вы ещё не откликались.</p>')));
}

function handleApplicationDecision(res,user,params) {
  const app=state.applications.find(x=>x.id===params.get('application_id')&&x.status==='pending');
  if(!app) return redirect(res,'/applications?error=notfound');
  const post=findPost(app.post_id,app.post_type);
  if(!post||post.user_id!==user.id) return redirect(res,'/applications?error=bad');
  const decision=params.get('decision');
  if(decision==='reject'){
    app.status='rejected'; notify(app.user_id,'application','Отклик отклонён','Автор отклонил отклик.','/applications');
    save(); return redirect(res,'/applications?msg=cancelled');
  }
  if(decision!=='accept') return redirect(res,'/applications?error=bad');
  const buyerId=app.post_type==='demand'?post.user_id:app.user_id;
  const sellerId=app.post_type==='demand'?app.user_id:post.user_id;
  const price=app.offered_price===null ? Number(post.price||0) : app.offered_price;
  if(price>0){
    const buyer=state.users.find(x=>x.id===buyerId), seller=state.users.find(x=>x.id===sellerId);
    if(!canTrade(buyer)||!canTrade(seller)) return redirect(res,'/applications?error=age');
    if(balance(buyerId,'available')<price) return redirect(res,'/applications?error=insufficient');
    recordTx('deal_escrow_hold',buyerId,{applicationId:app.id,amount:price},[
      {accountId:account(buyerId,'available').id,amount:-price,note:'Резерв сделки'},
      {accountId:account(buyerId,'held').id,amount:price,note:'Резерв сделки'}
    ]);
  }
  const deal={id:crypto.randomUUID(),application_id:app.id,post_id:post.id,post_type:app.post_type,
    buyer_id:buyerId,seller_id:sellerId,price,terms_mode:post.price_mode||'fixed',status:'in_progress',created_at:new Date().toISOString()};
  state.deals.push(deal); app.status='accepted'; post.status='in_progress';
  notify(buyerId,'deal','Сделка создана','Условия приняты. Сделка создана.','/deals');
  notify(sellerId,'deal','Сделка создана','Условия приняты. Сделка создана.','/deals');
  save();
  redirect(res,'/deals?msg=purchased');
}

function pageDeals(res,user,url) {
  const deals=state.deals.filter(x=>x.buyer_id===user.id||x.seller_id===user.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const cards=deals.map(d=>{
    const p=findPost(d.post_id,d.post_type); const other=state.users.find(x=>x.id===(d.buyer_id===user.id?d.seller_id:d.buyer_id));
    let actions='';
    if(d.status==='in_progress'&&d.seller_id===user.id) actions+='<form method="POST" action="/deals/action"><input type="hidden" name="deal_id" value="'+d.id+'"><input type="hidden" name="action" value="deliver"><button class="btn btn-primary btn-sm">Отметить выполненным</button></form>';
    if(d.status==='waiting_confirmation'&&d.buyer_id===user.id) actions+='<form method="POST" action="/deals/action"><input type="hidden" name="deal_id" value="'+d.id+'"><input type="hidden" name="action" value="confirm"><button class="btn btn-primary btn-sm">Подтвердить и оплатить</button></form>';
    if(d.status==='in_progress'||d.status==='waiting_confirmation') actions+='<form method="POST" action="/deals/action"><input type="hidden" name="deal_id" value="'+d.id+'"><input type="hidden" name="action" value="dispute"><button class="btn btn-ghost btn-sm">Открыть спор</button></form>';
    const messages=state.deal_messages.filter(m=>m.deal_id===d.id).slice(-8);
    const thread=messages.map(m=>{const author=state.users.find(u=>u.id===m.user_id);return '<div class="card" style="padding:10px;margin:8px 0"><b class="small">'+esc(author?author.full_name:'Участник')+'</b><p>'+esc(m.message)+'</p><span class="muted small">'+new Date(m.created_at).toLocaleString('ru-RU')+'</span></div>';}).join('');
    const canMessage=['in_progress','waiting_confirmation','disputed'].includes(d.status);
    const chat=canMessage?'<div class="mt-1"><h3>Переписка по сделке</h3>'+(thread||'<p class="muted small">Сообщений пока нет.</p>')+'<form method="POST" action="/deals/message"><input type="hidden" name="deal_id" value="'+d.id+'"><textarea name="message" rows="2" maxlength="1000" required placeholder="Сообщение участнику сделки"></textarea><button class="btn btn-ghost btn-sm">Отправить</button></form></div>':'';
    const reviewExists=state.reviews.some(r=>r.deal_id===d.id&&r.reviewer_id===user.id);
    const review=d.status==='completed'&&d.buyer_id===user.id&&!reviewExists?'<form method="POST" action="/deals/review" class="mt-1"><input type="hidden" name="deal_id" value="'+d.id+'"><label>Оценка исполнителя</label><select name="rating"><option value="5">5 — отлично</option><option value="4">4 — хорошо</option><option value="3">3 — нормально</option><option value="2">2 — плохо</option><option value="1">1 — очень плохо</option></select><textarea name="comment" rows="2" maxlength="400" placeholder="Комментарий (необязательно)"></textarea><button class="btn btn-ghost btn-sm">Оставить отзыв</button></form>':'';
    const priceText=d.terms_mode==='barter'?'Обмен':d.terms_mode==='free'?'Бесплатно':d.price+' ScRl'+(d.price>0?' в escrow':'');
    return '<div class="card"><div class="row-between"><b>'+esc(p?p.title:'Сделка')+'</b><span class="badge badge-muted">'+esc(d.status)+'</span></div><p class="muted small">Участник: '+esc(other?other.full_name:'—')+' · '+priceText+'</p><div class="row mt-1">'+actions+'</div>'+chat+review+'</div>';
  }).join('');
  sendHtml(res,layout('Мои сделки',user,flashBox(url)+'<h1>Мои сделки</h1>'+(cards||'<div class="card muted">Пока нет сделок. Найдите публикацию и откликнитесь.</div>')));
}

function handleDealAction(res,user,params) {
  const deal=state.deals.find(x=>x.id===params.get('deal_id'));
  if(!deal||(deal.buyer_id!==user.id&&deal.seller_id!==user.id)) return redirect(res,'/deals?error=bad');
  const action=params.get('action');
  if(action==='deliver'&&deal.seller_id===user.id&&deal.status==='in_progress'){
    deal.status='waiting_confirmation'; deal.delivered_at=new Date().toISOString();
    notify(deal.buyer_id,'deal','Ожидает подтверждения','Исполнитель отметил сделку выполненной.','/deals');
  } else if(action==='confirm'&&deal.buyer_id===user.id&&deal.status==='waiting_confirmation'){
    if(deal.price>0) recordTx('deal_escrow_release',user.id,{dealId:deal.id,amount:deal.price},[
      {accountId:account(deal.buyer_id,'held').id,amount:-deal.price,note:'Подтверждение сделки'},
      {accountId:account(deal.seller_id,'available').id,amount:deal.price,note:'Оплата исполнителю'}
    ]);
    deal.status='completed'; deal.completed_at=new Date().toISOString();
    const p=findPost(deal.post_id,deal.post_type); if(p)p.status='completed';
    notify(deal.seller_id,'deal','Сделка завершена','Покупатель подтвердил выполнение.','/deals');
  } else if(action==='dispute'&&(deal.status==='in_progress'||deal.status==='waiting_confirmation')){
    deal.status='disputed';
    state.reports.push({id:crypto.randomUUID(),reporter_id:user.id,target_type:'deal',target_id:deal.id,reason:'Спор по сделке',status:'open',created_at:new Date().toISOString()});
    notify(null,'moderation','Новый спор','Сделка требует решения администратора.','/admin/moderation');
  } else return redirect(res,'/deals?error=bad');
  save(); redirect(res,'/deals?msg=delivered');
}


function handleDealMessage(res,user,params) {
  const deal=state.deals.find(x=>x.id===params.get('deal_id'));
  const message=(params.get('message')||'').trim();
  if(!deal||(deal.buyer_id!==user.id&&deal.seller_id!==user.id)||
     !['in_progress','waiting_confirmation','disputed'].includes(deal.status)||
     message.length<1||message.length>1000) return redirect(res,'/deals?error=bad');
  state.deal_messages.push({id:crypto.randomUUID(),deal_id:deal.id,user_id:user.id,message,created_at:new Date().toISOString()});
  const recipient=deal.buyer_id===user.id?deal.seller_id:deal.buyer_id;
  notify(recipient,'message','Новое сообщение по сделке','У вас новое сообщение по сделке.','/deals');
  save(); redirect(res,'/deals');
}

function handleDealReview(res,user,params) {
  const deal=state.deals.find(x=>x.id===params.get('deal_id')&&x.status==='completed'&&x.buyer_id===user.id);
  const rating=Number(params.get('rating'));
  const comment=(params.get('comment')||'').trim();
  if(!deal||!Number.isInteger(rating)||rating<1||rating>5||
     state.reviews.some(r=>r.deal_id===deal.id&&r.reviewer_id===user.id)) return redirect(res,'/deals?error=bad');
  state.reviews.push({id:crypto.randomUUID(),deal_id:deal.id,reviewer_id:user.id,reviewed_user_id:deal.seller_id,rating,comment:comment.slice(0,400),created_at:new Date().toISOString()});
  notify(deal.seller_id,'review','Новый отзыв','Покупатель оставил отзыв по завершённой сделке.','/profile');
  save(); redirect(res,'/deals?msg=confirmed');
}

function handleFavoriteToggle(res,user,params) {
  const type=params.get('post_type'), post=findPost(params.get('post_id'),type);
  if(!post||post.status!=='active'||post.user_id===user.id) return redirect(res,'/marketplace?error=bad');
  const index=state.favorites.findIndex(x=>x.user_id===user.id&&x.post_id===post.id&&x.post_type===type);
  if(index>=0) state.favorites.splice(index,1);
  else state.favorites.push({id:crypto.randomUUID(),user_id:user.id,post_id:post.id,post_type:type,created_at:new Date().toISOString()});
  save(); redirect(res,'/favorites');
}

function pageFavorites(res,user) {
  const items=state.favorites.filter(x=>x.user_id===user.id).map(f=>({f,post:findPost(f.post_id,f.post_type)})).filter(x=>x.post&&x.post.status==='active');
  const html=items.map(x=>postCard(x.post,x.f.post_type,user,true)).join('');
  sendHtml(res,layout('Избранное',user,'<h1>Избранное</h1>'+(html||'<div class="card muted">Избранных публикаций пока нет.</div>')));
}

function pageNotifications(res,user) {
  const list=state.notifications.filter(x=>x.user_id===user.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100);
  const html=list.map(n=>'<div class="card"><div class="row-between"><b>'+esc(n.title)+'</b><span class="badge '+(n.is_read?'badge-muted':'badge-primary-soft')+'">'+(n.is_read?'Прочитано':'Новое')+'</span></div><p class="mt-1">'+esc(n.message)+'</p><div class="row-between mt-1"><span class="muted small">'+new Date(n.created_at).toLocaleString('ru-RU')+'</span><a href="'+esc(n.href||'/')+'">Открыть</a></div></div>').join('');
  state.notifications.filter(x=>x.user_id===user.id).forEach(x=>x.is_read=true); save();
  sendHtml(res,layout('Уведомления',user,'<h1>Уведомления</h1>'+(html||'<div class="card muted">Новых уведомлений нет.</div>')));
}

function pageProfile(res,user,url) {
  const completed=state.deals.filter(x=>x.status==='completed'&&(x.buyer_id===user.id||x.seller_id===user.id)).length;
  const posts=state.demands.concat(state.offers).filter(x=>x.user_id===user.id&&x.status==='active').length;
  const reviews=state.reviews.filter(x=>x.reviewed_user_id===user.id);
  const average=reviews.length?(reviews.reduce((s,x)=>s+x.rating,0)/reviews.length).toFixed(1):'—';
  const reviewHtml=reviews.slice(-10).reverse().map(x=>'<div class="card"><b>'+x.rating+'/5</b><p>'+esc(x.comment||'Без комментария')+'</p></div>').join('');
  sendHtml(res,layout('Профиль',user,flashBox(url)+'<h1>Профиль</h1><div class="card"><h2>'+esc(user.full_name)+'</h2><p class="muted">'+esc(user.class_name||'Участник ScRl')+'</p><p class="mt-1">'+esc(user.bio||'Добавьте краткое описание своих интересов и навыков.')+'</p><div class="row mt-1"><span class="badge badge-primary-soft">Активных публикаций: '+posts+'</span><span class="badge badge-success">Завершённых сделок: '+completed+'</span><span class="badge badge-accent">Рейтинг: '+average+' ('+reviews.length+')</span></div></div><div class="card"><h2>О себе</h2><form method="POST" action="/profile/update"><textarea name="bio" rows="4" maxlength="400" placeholder="Расскажите о своих навыках и интересах">'+esc(user.bio||'')+'</textarea><button class="btn btn-primary">Сохранить профиль</button></form></div><h2 class="mt-2">Отзывы</h2>'+(reviewHtml||'<p class="muted">Отзывов пока нет.</p>')));
}

function handleProfileUpdate(res,user,params) {
  const bio=(params.get('bio')||'').trim();
  user.bio=bio.slice(0,400); save(); redirect(res,'/profile?msg=created');
}

function handleReport(res,user,params) {
  const targetType=params.get('target_type'), targetId=params.get('target_id');
  const reason=(params.get('reason')||'').trim();
  if(!reason||reason.length<5||reason.length>240) return redirect(res,'/marketplace?error=fields');
  if(targetType==='post'&&!findPost(targetId,params.get('post_type'))) return redirect(res,'/marketplace?error=notfound');
  if(targetType==='deal'&&!state.deals.some(x=>x.id===targetId&&(x.buyer_id===user.id||x.seller_id===user.id))) return redirect(res,'/deals?error=bad');
  state.reports.push({id:crypto.randomUUID(),reporter_id:user.id,target_type:targetType,target_id:targetId,post_type:params.get('post_type')||null,reason:reason.slice(0,240),status:'open',created_at:new Date().toISOString()});
  save(); redirect(res,'/notifications');
}

module.exports={notify,pageBoard,pageMarketplace,handleCreatePost,handleApply,pageApplications,handleApplicationDecision,pageDeals,handleDealAction,handleDealMessage,handleDealReview,handleFavoriteToggle,pageFavorites,pageNotifications,pageProfile,handleProfileUpdate,handleReport};
