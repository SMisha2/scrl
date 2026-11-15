const crypto = require('node:crypto');
const { state, save, balance, systemAccount } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { notify } = require('../utils/notifications');
const { analyseText } = require('../services/moderation-rules');

function pageModeration(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const cases = state.moderation_cases.filter(c => c.status === 'open').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const caseCards = cases.map(item => {
    let target = null;
    if (item.kind === 'post') {
      const collection = item.post_kind === 'offer' ? state.offer_posts : state.demand_posts;
      target = collection.find(p => p.id === item.target_id);
    } else if (item.kind === 'deal') target = state.deals.find(d => d.id === item.target_id);
    const title = item.kind === 'post' ? (target ? target.title : 'Публикация удалена') : 'Спор по сделке';
    const details = item.kind === 'post' && target ? target.description : item.reason;
    return '<article class="card"><div class="row-between"><b>' + esc(title) + '</b><span class="badge badge-accent">' + esc(item.kind) + '</span></div>' +
      '<p class="muted small">' + new Date(item.created_at).toLocaleString('ru-RU') + '</p><p class="mt-1">' + esc(details || item.reason || '') + '</p>' +
      '<p class="muted small mt-1">Основание: ' + esc(item.reason || 'Ручная проверка') + '</p>' +
      (item.recommendation ? '<p class="small">' + esc(item.recommendation) + '</p>' : '') +
      '<div class="row mt-2"><form method="POST" action="/admin/moderation/action"><input type="hidden" name="case_id" value="' + esc(item.id) + '"><input type="hidden" name="decision" value="approve"><button class="btn btn-primary btn-sm">Одобрить / закрыть</button></form>' +
      '<form method="POST" action="/admin/moderation/action"><input type="hidden" name="case_id" value="' + esc(item.id) + '"><input type="hidden" name="decision" value="reject"><button class="btn btn-danger btn-sm">Отклонить публикацию</button></form></div></article>';
  }).join('');
  const reports = state.reports.filter(r => r.status === 'open');
  const reportRows = reports.map(r => {
    const collection = r.post_kind === 'offer' ? state.offer_posts : state.demand_posts;
    const post = collection.find(p => p.id === r.post_id);
    const author = state.users.find(u => u.id === r.created_by);
    return '<div class="card"><b>' + esc(post ? post.title : 'Публикация отсутствует') + '</b><p class="small muted">Жалоба от ' + esc(author ? author.full_name : 'участника') + '</p><p>' + esc(r.reason) + '</p>' +
      '<form method="POST" action="/admin/moderation/report"><input type="hidden" name="report_id" value="' + esc(r.id) + '"><button class="btn btn-ghost btn-sm">Закрыть жалобу</button></form></div>';
  }).join('');
  sendHtml(res, layout('Модерация', user, flashBox(url) + '<div class="row-between"><div><h1>Модерация</h1><p class="muted">Решения остаются за администратором. Автоматический анализ — только рекомендация.</p></div><a class="btn btn-primary" href="/admin/ai">AI-помощник</a></div>' +
    '<h2>Очередь проверок (' + cases.length + ')</h2>' + (caseCards || '<div class="card"><p class="muted">Открытых проверок нет.</p></div>') +
    '<h2 class="mt-2">Жалобы (' + reports.length + ')</h2>' + (reportRows || '<div class="card"><p class="muted">Открытых жалоб нет.</p></div>')));
}

function handleModerationAction(res, user, params) {
  if (user.role !== 'admin') return redirect(res, '/');
  const item = state.moderation_cases.find(c => c.id === params.get('case_id') && c.status === 'open');
  if (!item) return redirect(res, '/admin/moderation?error=notfound');
  const decision = params.get('decision');
  const approved = decision === 'approve';
  if (item.kind === 'post') {
    const collection = item.post_kind === 'offer' ? state.offer_posts : state.demand_posts;
    const post = collection.find(p => p.id === item.target_id);
    if (post) post.status = approved ? 'active' : 'rejected';
    if (post) notify(post.user_id, 'moderation', approved ? 'Публикация проверена' : 'Публикация отклонена', approved ? 'Публикация одобрена модератором.' : 'Публикация отклонена после проверки.', item.post_kind === 'offer' ? '/offers' : '/demand');
  }
  if (item.kind === 'deal') {
    const deal = state.deals.find(d => d.id === item.target_id);
    if (deal && !approved) {
      deal.status = 'disputed';
      deal.admin_decision = 'manual_review_required';
    }
    if (deal && approved) deal.admin_reviewed_at = new Date().toISOString();
  }
  item.status = 'resolved';
  item.decision = approved ? 'approved' : 'rejected';
  item.resolved_by = user.id;
  item.resolved_at = new Date().toISOString();
  state.moderation_actions.push({ id: crypto.randomUUID(), case_id: item.id, admin_id: user.id, action: item.decision, created_at: new Date().toISOString() });
  state.admin_audit_logs.push({ id: crypto.randomUUID(), actor_id: user.id, action: 'moderation_' + item.decision, target_id: item.target_id, reason: item.reason || '', created_at: new Date().toISOString() });
  save();
  return redirect(res, '/admin/moderation?msg=reviewed');
}

function handleReportAction(res, user, params) {
  if (user.role !== 'admin') return redirect(res, '/');
  const report = state.reports.find(r => r.id === params.get('report_id') && r.status === 'open');
  if (!report) return redirect(res, '/admin/moderation?error=notfound');
  report.status = 'resolved';
  report.resolved_by = user.id;
  report.resolved_at = new Date().toISOString();
  state.admin_audit_logs.push({ id: crypto.randomUUID(), actor_id: user.id, action: 'report_closed', target_id: report.id, reason: report.reason, created_at: new Date().toISOString() });
  save();
  return redirect(res, '/admin/moderation?msg=reviewed');
}

function createAnswer(user, question) {
  const q = question.toLowerCase();
  const activeDemand = state.demand_posts.filter(p => p.status === 'active').length;
  const activeOffers = state.offer_posts.filter(p => p.status === 'active').length;
  const openDeals = state.deals.filter(d => ['accepted', 'in_progress', 'awaiting_confirmation', 'disputed'].includes(d.status)).length;
  const pendingCases = state.moderation_cases.filter(c => c.status === 'open').length;
  const activeAuctions = state.auctions.filter(a => a.status === 'active').length;
  const students = state.users.filter(u => u.role === 'student').length;
  const circulating = state.accounts.filter(a => a.user_id && ['available', 'held'].includes(a.kind)).reduce((sum, a) => sum + a.balance, 0);
  if (q.includes('эконом') || q.includes('баланс') || q.includes('токен')) {
    return 'Сводка школьной экономики ScRl:\n' +
      '• Учеников: ' + students + '\n' +
      '• Объём доступных и заблокированных ScRl по счетам: ' + circulating.toLocaleString('ru-RU') + '\n' +
      '• Открытых сделок/споров: ' + openDeals + '\n' +
      '• Активных аукционов ScRl: ' + activeAuctions + '\n' +
      'Это агрегированные данные текущего файла хранилища; реальные RUB сюда не включаются.';
  }
  if (q.includes('спрос') || q.includes('объяв') || q.includes('публикац')) {
    return 'Состояние досок:\n• Активных запросов Demand: ' + activeDemand + '\n• Активных предложений Offer: ' + activeOffers + '\n• Открытых проверок модерации: ' + pendingCases + '\n\nПубликации с высокорисковыми совпадениями временно скрываются до решения администратора.';
  }
  if (q.includes('жалоб') || q.includes('спор') || q.includes('модерац')) {
    const reports = state.reports.filter(r => r.status === 'open').length;
    const disputes = state.deals.filter(d => d.status === 'disputed').length;
    return 'Очередь модерации:\n• Открытые случаи проверки: ' + pendingCases + '\n• Открытые жалобы: ' + reports + '\n• Спорные сделки: ' + disputes + '\n\nОткройте раздел «Модерация», чтобы изучить контекст и принять решение. Я не устанавливаю виновность и не блокирую аккаунты.';
  }
  if (q.includes('аукцион')) {
    return 'Сейчас активных внутренних аукционов ScRl: ' + activeAuctions + '. По утверждённой финансовой спецификации денежные ставки и RUB Auction не используются.';
  }
  if (q.includes('сделк')) {
    return 'Сейчас открытых сделок: ' + openDeals + '. В ScRl предусмотрены статусы accepted, in_progress, awaiting_confirmation, completed и disputed. Средства в спорных сделках остаются в escrow до решения уполномоченного администратора.';
  }
  const allPosts = state.demand_posts.concat(state.offer_posts);
  const flagged = allPosts.filter(p => p.status === 'pending' || p.moderation_level === 'high').length;
  if (q.includes('подозр') || q.includes('риск') || q.includes('провер')) {
    return 'Предварительная проверка контента:\n• Всего публикаций: ' + allPosts.length + '\n• Требуют ручной проверки: ' + flagged + '\n• Открытых модерационных случаев: ' + pendingCases + '\n\nЭто правила по ключевым признакам, а не автоматическое обвинение. Откройте карточку случая для ручной оценки.';
  }
  const analysis = analyseText(question);
  return 'Я — помощник администратора ScRl в локальном режиме. Сейчас могу подготовить сводку экономики, проверить очередь жалоб и споров, показать состояние досок, аукционов и сделок.\n\n' +
    'В вашем сообщении: ' + (analysis.findings.length ? analysis.findings.map(x => x.label).join('; ') : 'не найдено совпадений с локальными правилами') + '.\n\n' +
    'Внешняя языковая модель не подключена; я не отправляю данные учеников стороннему провайдеру.';
}

function pageAiChat(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const messages = state.ai_messages.filter(m => m.admin_id === user.id).slice(-40);
  const transcript = messages.map(m => '<div class="card" style="padding:12px"><b>' + (m.role === 'user' ? 'Вы' : 'ScRl Assistant') + '</b><p class="mt-1">' + esc(m.content).replace(/\n/g, '<br>') + '</p><span class="muted small">' + new Date(m.created_at).toLocaleString('ru-RU') + '</span></div>').join('');
  sendHtml(res, layout('AI Moderator', user, '<div class="row-between"><div><h1>AI Moderator</h1><p class="muted">Локальный режим: анализирует агрегированные данные и контент, не принимает решения за администратора.</p></div><a class="btn btn-ghost btn-sm" href="/admin/moderation">К модерации</a></div>' +
    '<div class="alert alert-info">Внешний ИИ-провайдер не настроен. Чат уже отвечает на вопросы по актуальной статистике ScRl; данные учеников не отправляются вовне.</div>' +
    (transcript || '<div class="card"><p class="muted">Примеры вопросов: «Сводка экономики», «Сколько открытых споров?», «Покажи риски публикаций», «Состояние аукционов».</p></div>') +
    '<form class="card" method="POST" action="/admin/ai/chat"><label>Сообщение помощнику</label><textarea name="message" rows="3" maxlength="1000" required placeholder="Задайте вопрос по данным ScRl"></textarea><button class="btn btn-primary">Отправить</button></form>'));
}

function handleAiChat(res, user, params) {
  if (user.role !== 'admin') return redirect(res, '/');
  const question = (params.get('message') || '').trim().slice(0, 1000);
  if (!question) return redirect(res, '/admin/ai?error=fields');
  const now = new Date().toISOString();
  state.ai_messages.push({ id: crypto.randomUUID(), admin_id: user.id, role: 'user', content: question, created_at: now });
  const answer = createAnswer(user, question);
  state.ai_messages.push({ id: crypto.randomUUID(), admin_id: user.id, role: 'assistant', content: answer, created_at: new Date().toISOString() });
  save();
  return redirect(res, '/admin/ai');
}

module.exports = {
  pageModeration, handleModerationAction, handleReportAction,
  pageAiChat, handleAiChat
};
