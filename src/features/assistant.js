const crypto = require('node:crypto');
const { state, save, balance } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { layout } = require('../views/layout');

function economySnapshot() {
  const users=state.users.filter(x=>x.role==='student').length;
  const activeDemands=state.demand_posts.filter(x=>x.status==='active').length;
  const activeOffers=state.offer_posts.filter(x=>x.status==='active').length;
  const pendingApplications=state.applications.filter(x=>x.status==='pending').length;
  const activeDeals=state.deals.filter(x=>['in_progress','waiting_confirmation','disputed'].includes(x.status)).length;
  const openReports=state.reports.filter(x=>x.status==='open').length;
  const activeAuctions=state.auctions.filter(x=>x.status==='active').length;
  const issued=state.transactions.filter(x=>['signup_bonus','credit_teacher','credit_admin'].includes(x.kind)).reduce((s,x)=>s+Number(x.payload&&x.payload.amount||0),0);
  const circulating=state.accounts.filter(x=>x.user_id&&['available','held'].includes(x.kind)).reduce((s,x)=>s+x.balance,0);
  const held=state.accounts.filter(x=>x.kind==='held').reduce((s,x)=>s+x.balance,0);
  return {users,activeDemands,activeOffers,pendingApplications,activeDeals,openReports,activeAuctions,issued,circulating,held};
}

function localModerationAnalysis(text) {
  const value=String(text||'').toLowerCase();
  const rules=[
    {words:['готовые ответы','ответы на контрольную','сдать за меня','сделаю домашнее задание за'],label:'Академическая нечестность',risk:'high'},
    {words:['продам аккаунт','куплю аккаунт','чужой аккаунт'],label:'Торговля аккаунтами',risk:'high'},
    {words:['паспорт','номер карты','cvv','домашний адрес','номер телефона'],label:'Персональные или платёжные данные',risk:'high'},
    {words:['вейп','наркот','оружие','алкоголь'],label:'Потенциально запрещённая категория',risk:'high'}
  ];
  const found=rules.filter(r=>r.words.some(w=>value.includes(w)));
  return {risk:found.length?'high':'low',findings:found.map(x=>x.label),recommendation:found.length?'Передать человеку для проверки; автоматическое решение не принимать.':'Очевидных совпадений с локальным списком правил не обнаружено. Нужна обычная проверка контекста.',source:'Локальный набор правил ScRl. Это предварительный сигнал, не решение модератора.'};
}

function answerAdminQuestion(question) {
  const q=String(question||'').toLowerCase();
  const s=economySnapshot();
  if(q.includes('объяв')||q.includes('модерац')||q.includes('опасн')){
    const flagged=state.demand_posts.concat(state.offer_posts).filter(p=>p.status==='active').map(p=>({p,a:localModerationAnalysis(p.title+' '+p.description)})).filter(x=>x.a.risk==='high').slice(0,10);
    return 'Проверка публикаций по локальным правилам:\nАктивных запросов: '+s.activeDemands+'\nАктивных предложений: '+s.activeOffers+'\nПубликаций с совпадениями: '+flagged.length+'\n'+(flagged.length?flagged.map(x=>'• «'+x.p.title+'» — '+x.a.findings.join(', ')).join('\n'):'Совпадений не найдено.')+'\n\nЭто предварительные сигналы. Решение принимает администратор.';
  }
  if(q.includes('жалоб')||q.includes('спор')){
    return 'Очередь модерации:\nОткрытых жалоб и споров: '+s.openReports+'\nАктивных сделок: '+s.activeDeals+'\n\nОткройте раздел «Модерация», чтобы проверить контекст и принять решение.';
  }
  if(q.includes('аукцион')){
    return 'Сейчас активных аукционов: '+s.activeAuctions+'. Все ставки и списания в ScRl Auction выполняются только во внутренней валюте ScRl. RUB-ставок и денежных призов спецификация не предусматривает.';
  }
  if(q.includes('эконом')||q.includes('баланс')||q.includes('отчёт')||q.includes('отчет')){
    return 'Сводка экономики ScRl:\nУчеников: '+s.users+'\nНачислено по учтённым типам: '+s.issued.toLocaleString('ru-RU')+' ScRl\nДоступно и заблокировано на пользовательских счетах: '+s.circulating.toLocaleString('ru-RU')+' ScRl\nВ escrow: '+s.held.toLocaleString('ru-RU')+' ScRl\nЗапросы: '+s.activeDemands+' · предложения: '+s.activeOffers+'\nОжидают отклика/решения: '+s.pendingApplications+'\nАктивные сделки/споры: '+s.activeDeals+'\nОткрытые жалобы: '+s.openReports+'\n\nЭто агрегат текущего файла данных, не банковский или бухгалтерский отчёт.';
  }
  if(q.includes('пользоват')||q.includes('ученик')){
    return 'В ScRl зарегистрировано учеников: '+s.users+'. Активных запросов: '+s.activeDemands+'. Активных предложений: '+s.activeOffers+'. Для просмотра персональных записей используйте административную панель пользователей.';
  }
  return 'Я — встроенный помощник модератора ScRl в локальном режиме. Могу показать сводку экономики, проверить публикации по локальным правилам, посчитать открытые жалобы и споры или показать состояние аукционов.\n\nПопробуйте спросить: «Составь отчёт по экономике», «Покажи публикации с рисками», «Сколько открытых жалоб?».\n\nВнешняя AI-модель не подключена: сообщения и данные учеников не отправляются стороннему провайдеру.';
}

function pageAssistant(res,user) {
  if(user.role!=='admin') return redirect(res,'/');
  const messages=state.ai_messages.filter(x=>x.user_id===user.id).slice(-30);
  const items=messages.map(m=>'<div class="card"><div class="muted small">'+(m.role==='user'?'Вы':'ScRl Assistant')+' · '+new Date(m.created_at).toLocaleString('ru-RU')+'</div><p style="white-space:pre-wrap;margin-top:8px">'+esc(m.content)+'</p></div>').join('');
  sendHtml(res,layout('AI-помощник',user,'<div class="row-between"><div><h1>AI Moderator</h1><p class="muted">Локальный режим · анализ агрегированных данных ScRl</p></div><span class="badge badge-accent">AI provider: не подключён</span></div><div class="alert alert-info">Сейчас работает встроенный локальный помощник: он анализирует данные проекта по правилам и не отправляет информацию об учениках внешнему сервису. Его выводы — подсказки, не решения.</div><div class="card"><form method="POST" action="/admin/ai/chat"><label>Сообщение помощнику</label><textarea name="message" rows="3" maxlength="1000" required placeholder="Например: составь отчёт по экономике за текущий момент"></textarea><button class="btn btn-primary">Отправить</button></form><div class="row mt-1"><a class="btn btn-ghost btn-sm" href="/admin/ai?q=report">Отчёт по экономике</a><a class="btn btn-ghost btn-sm" href="/admin/ai?q=moderation">Проверка публикаций</a><a class="btn btn-ghost btn-sm" href="/admin/ai?q=complaints">Жалобы и споры</a></div></div>'+(items||'<div class="card muted">История диалога пока пуста.</div>')));
}

function handleAssistantChat(res,user,params) {
  if(user.role!=='admin') return redirect(res,'/');
  const message=(params.get('message')||'').trim().slice(0,1000);
  if(!message) return redirect(res,'/admin/ai');
  const answer=answerAdminQuestion(message);
  const now=new Date().toISOString();
  state.ai_messages.push({id:crypto.randomUUID(),user_id:user.id,role:'user',content:message,created_at:now});
  state.ai_messages.push({id:crypto.randomUUID(),user_id:user.id,role:'assistant',content:answer,created_at:new Date().toISOString()});
  save(); redirect(res,'/admin/ai');
}

function pageModeration(res,user) {
  if(user.role!=='admin') return redirect(res,'/');
  const reports=state.reports.filter(x=>x.status==='open').sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const cards=reports.map(r=>{
    let target='Объект';
    if(r.target_type==='post'){
      const p=(r.post_type==='demand'?state.demand_posts:state.offer_posts).find(x=>x.id===r.target_id);
      if(p) target='Публикация: '+p.title+' — '+p.description;
    } else {
      const d=state.deals.find(x=>x.id===r.target_id);
      if(d) target='Сделка: '+d.id+' · '+d.status;
    }
    const author=state.users.find(x=>x.id===r.reporter_id);
    return '<div class="card"><div class="row-between"><b>'+esc(r.target_type)+'</b><span class="badge badge-warning">Открыта</span></div><p class="mt-1">'+esc(target)+'</p><p class="muted small">Жалоба от '+esc(author?author.full_name:'участника')+': '+esc(r.reason)+'</p><div class="row mt-1"><form method="POST" action="/admin/moderation/action"><input type="hidden" name="report_id" value="'+r.id+'"><input type="hidden" name="decision" value="dismiss"><button class="btn btn-ghost btn-sm">Отклонить жалобу</button></form><form method="POST" action="/admin/moderation/action"><input type="hidden" name="report_id" value="'+r.id+'"><input type="hidden" name="decision" value="remove"><button class="btn btn-danger btn-sm">Снять публикацию / закрыть спор</button></form></div></div>';
  }).join('');
  const flagged=state.demand_posts.concat(state.offer_posts).filter(p=>p.status==='active').map(p=>({p,a:localModerationAnalysis(p.title+' '+p.description)})).filter(x=>x.a.risk==='high');
  const flaggedHtml=flagged.map(x=>'<div class="card"><b>'+esc(x.p.title)+'</b><p class="muted small">'+esc(x.a.findings.join(', '))+' — требуется ручная проверка.</p></div>').join('');
  sendHtml(res,layout('Модерация',user,'<h1>Модерация</h1><p class="muted">Сигналы риска не приводят к автоматическим блокировкам или списаниям.</p><h2 class="mt-2">Открытые жалобы и споры</h2>'+(cards||'<p class="muted">Открытых жалоб нет.</p>')+'<h2 class="mt-2">Публикации для дополнительной проверки</h2>'+(flaggedHtml||'<p class="muted">Локальные правила не обнаружили совпадений.</p>')));
}

function handleModerationAction(res,user,params) {
  if(user.role!=='admin') return redirect(res,'/');
  const report=state.reports.find(x=>x.id===params.get('report_id')&&x.status==='open');
  if(!report) return redirect(res,'/admin/moderation');
  const decision=params.get('decision');
  if(decision==='remove'&&report.target_type==='post'){
    const post=(report.post_type==='demand'?state.demand_posts:state.offer_posts).find(x=>x.id===report.target_id);
    if(post) post.status='removed';
  }
  if(decision==='remove'&&report.target_type==='deal'){
    const deal=state.deals.find(x=>x.id===report.target_id);
    if(deal) deal.status='disputed';
  }
  if(!['remove','dismiss'].includes(decision)) return redirect(res,'/admin/moderation');
  report.status=decision==='dismiss'?'dismissed':'action_taken';
  report.reviewed_by=user.id; report.reviewed_at=new Date().toISOString();
  state.audit_logs.push({id:crypto.randomUUID(),actor_id:user.id,action:'moderation_'+decision,target_type:report.target_type,target_id:report.target_id,created_at:new Date().toISOString()});
  save(); redirect(res,'/admin/moderation');
}

module.exports={pageAssistant,handleAssistantChat,pageModeration,handleModerationAction,localModerationAnalysis};
