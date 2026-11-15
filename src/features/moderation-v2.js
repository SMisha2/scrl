const crypto = require('node:crypto');
const { state, save, balance, account, systemAccount, recordTx } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { notify } = require('../utils/notifications');
const { analyseText } = require('../services/moderation-rules');

function audit(admin, action, targetId, reason) {
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: admin.id, action,
    target_id: targetId || null, reason: String(reason || '').slice(0, 500),
    created_at: new Date().toISOString()
  });
}

function dealLedgerState(deal) {
  const held = state.accounts.find(item => item.user_id === deal.buyer_id && item.kind === 'held');
  if (!held) return { escrow: 0, settlement: null };
  const txs = state.transactions.filter(tx => tx.payload && tx.payload.dealId === deal.id);
  const txIds = new Set(txs.map(tx => tx.id));
  const escrow = state.entries
    .filter(entry => txIds.has(entry.tx_id) && entry.account_id === held.id)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const settlementTx = txs.find(tx => [
    'deal_settlement', 'deal_escrow_refund',
    'deal_dispute_refund', 'deal_dispute_release'
  ].includes(tx.kind)) || null;
  const decision = settlementTx
    ? (settlementTx.kind === 'deal_settlement' || settlementTx.kind === 'deal_dispute_release'
      ? 'release_seller' : 'refund_buyer')
    : null;
  return { escrow, settlement: settlementTx, decision, held };
}

function findPost(kind, id) {
  const list = kind === 'offer' ? state.offer_posts : state.demand_posts;
  return list.find(post => post.id === id) || null;
}

function reportMeta(report) {
  const targetType = report.target_type || (report.post_id ? 'post' : null);
  return {
    targetType,
    postId: report.post_id || (targetType === 'post' ? report.target_id : null),
    postKind: report.post_kind || (report.post_type === 'demand' ? 'demand' : report.post_type === 'offer' ? 'offer' : null),
    listingId: targetType === 'listing' ? report.target_id : null,
    reporterId: report.created_by || report.reporter_id || null
  };
}

function pageModeration(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const query = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
  const cases = state.moderation_cases.filter(item => item.status === 'open' && ['post', 'deal', 'listing'].includes(item.kind)).filter(item => {
    const post = item.kind === 'post' ? findPost(item.post_kind, item.target_id) : null;
    const deal = item.kind === 'deal' ? state.deals.find(x => x.id === item.target_id) : null;
    const listing = item.kind === 'listing' ? state.listings.find(x => x.id === item.target_id) : null;
    return !query || [item.reason, item.recommendation, post?.title, post?.description, listing?.title, listing?.description, deal?.dispute_reason, deal?.id]
      .filter(Boolean).join(' ').toLowerCase().includes(query);
  }).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  const caseHtml = cases.map(item => {
    const post = item.kind === 'post' ? findPost(item.post_kind, item.target_id) : null;
    const deal = item.kind === 'deal' ? state.deals.find(x => x.id === item.target_id) : null;
    const listing = item.kind === 'listing' ? state.listings.find(x => x.id === item.target_id) : null;
    const author = post ? state.users.find(x => x.id === post.user_id) : listing ? state.users.find(x => x.id === listing.seller_id) : null;
    const buyer = deal ? state.users.find(x => x.id === deal.buyer_id) : null;
    const seller = deal ? state.users.find(x => x.id === deal.seller_id) : null;
    let buttons = '';
    if (item.kind === 'post' || item.kind === 'listing') {
      const target = post || listing;
      buttons = target && target.status === 'pending'
        ? '<form method="POST" action="/admin/moderation/action"><input type="hidden" name="case_id" value="' + esc(item.id) + '"><input type="hidden" name="decision" value="approve"><button class="btn btn-primary btn-sm">Одобрить</button></form>' +
          '<form method="POST" action="/admin/moderation/action"><input type="hidden" name="case_id" value="' + esc(item.id) + '"><input type="hidden" name="decision" value="reject"><button class="btn btn-danger btn-sm">Отклонить</button></form>'
        : '<span class="badge badge-muted">Объект уже изменён — действие недоступно</span>';
    } else if (item.kind === 'deal' && deal?.status === 'disputed') {
      const paid = Number(deal.price || 0) > 0;
      buttons = '<form method="POST" action="/admin/moderation/action"><input type="hidden" name="case_id" value="' + esc(item.id) + '"><input type="hidden" name="decision" value="refund_buyer"><button class="btn btn-ghost btn-sm">' + (paid ? 'Вернуть ScRl заказчику' : 'Отменить сделку') + '</button></form>' +
        '<form method="POST" action="/admin/moderation/action"><input type="hidden" name="case_id" value="' + esc(item.id) + '"><input type="hidden" name="decision" value="release_seller"><button class="btn btn-primary btn-sm">' + (paid ? 'Завершить в пользу исполнителя' : 'Завершить сделку') + '</button></form>';
    } else {
      buttons = '<span class="badge badge-muted">Объект уже изменён — проверьте журнал</span>';
    }
    const title = post?.title || listing?.title || (deal ? 'Спор по сделке' : 'Объект не найден');
    const body = post?.description || listing?.description || deal?.dispute_reason || item.reason || 'Нет подробностей';
    return '<article class="card"><div class="row-between"><div><span class="badge badge-accent">' + esc(item.kind) + '</span> <span class="badge badge-muted">' + esc(post?.moderation_level || listing?.moderation_level || 'ручная проверка') + '</span></div><span class="muted small">' + esc(item.created_at || '') + '</span></div>' +
      '<h2 class="mt-1">' + esc(title) + '</h2>' +
      (author ? '<p class="muted small">Автор: ' + esc(author.full_name) + '</p>' : '') +
      (deal ? '<p class="muted small">Заказчик: ' + esc(buyer?.full_name || '—') + ' · Исполнитель: ' + esc(seller?.full_name || '—') + ' · Цена: ' + Number(deal.price || 0).toLocaleString('ru-RU') + ' ScRl · Escrow: ' + balance(deal.buyer_id, 'held').toLocaleString('ru-RU') + ' ScRl</p>' : '') +
      '<p class="mt-1">' + esc(body) + '</p><p class="muted small mt-1">Основание: ' + esc(item.reason || 'Ручная проверка') + '</p>' +
      (Array.isArray(post?.moderation_findings || listing?.moderation_findings) && (post?.moderation_findings || listing?.moderation_findings).length ? '<p class="small">Совпадения: ' + esc((post?.moderation_findings || listing?.moderation_findings).map(x => x.label).join('; ')) + '</p>' : '') +
      (item.recommendation ? '<p class="small muted">' + esc(item.recommendation) + '</p>' : '') +
      '<div class="row mt-2">' + buttons + '</div></article>';
  }).join('');

  const reports = state.reports.filter(report => report.status === 'open').filter(report => {
    const meta = reportMeta(report);
    const post = meta.targetType === 'post' ? findPost(meta.postKind, meta.postId) : null;
    const listing = meta.targetType === 'listing' ? state.listings.find(x => x.id === meta.listingId) : null;
    if (!['post', 'listing'].includes(meta.targetType)) return false;
    return !query || [report.reason, post?.title, post?.description, listing?.title, listing?.description, 'объект не найден']
      .filter(Boolean).join(' ').toLowerCase().includes(query);
  }).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const reportHtml = reports.map(report => {
    const meta = reportMeta(report);
    const post = meta.targetType === 'post' ? findPost(meta.postKind, meta.postId) : null;
    const listing = meta.targetType === 'listing' ? state.listings.find(x => x.id === meta.listingId) : null;
    const author = post ? state.users.find(x => x.id === post.user_id) : listing ? state.users.find(x => x.id === listing.seller_id) : null;
    const reporter = state.users.find(x => x.id === meta.reporterId);
    const title = post?.title || listing?.title || 'Объявление не найдено';
    const description = post?.description || listing?.description || '';
    const buttons = '<form method="POST" action="/admin/moderation/report"><input type="hidden" name="report_id" value="' + esc(report.id) + '"><input type="hidden" name="decision" value="dismiss"><button class="btn btn-ghost btn-sm">Отклонить жалобу</button></form>' +
      '<form method="POST" action="/admin/moderation/report"><input type="hidden" name="report_id" value="' + esc(report.id) + '"><input type="hidden" name="decision" value="remove"><button class="btn btn-danger btn-sm">Скрыть публикацию</button></form>';
    return '<article class="card"><div class="row-between"><b>' + esc(title) + '</b><span class="badge badge-accent">Жалоба · ' + esc(meta.targetType || 'объект') + '</span></div>' +
      (description ? '<p class="mt-1">' + esc(description) + '</p>' : '') +
      '<p class="muted small mt-1">Автор: ' + esc(author?.full_name || '—') + ' · Жалобу отправил: ' + esc(reporter?.full_name || 'участник') + '</p>' +
      '<p class="small">Причина: ' + esc(report.reason || 'Не указана') + '</p><div class="row mt-2">' + buttons + '</div></article>';
  }).join('');

  const allListings = state.demand_posts.concat(state.offer_posts, state.listings);
  const high = allListings.filter(p => p.status === 'pending' && p.moderation_level === 'high').length;
  const medium = allListings.filter(p => p.status === 'pending' && p.moderation_level === 'medium').length;
  const metrics = '<div class="grid grid-4"><div class="card"><span class="muted small">Проверки</span><h2>' + cases.length + '</h2></div><div class="card"><span class="muted small">Жалобы</span><h2>' + reports.length + '</h2></div><div class="card"><span class="muted small">Высокий риск</span><h2>' + high + '</h2></div><div class="card"><span class="muted small">Средний риск</span><h2>' + medium + '</h2></div></div>';
  const search = '<form class="card grid grid-2" method="GET" action="/admin/moderation"><div><label for="moderation-query">Поиск</label><input id="moderation-query" name="q" value="' + esc(query) + '" maxlength="100" placeholder="Название, описание, причина"></div><div class="row" style="align-self:end"><button class="btn btn-primary">Найти</button><a class="btn btn-ghost" href="/admin/moderation">Сбросить</a></div></form>';
  const auditRows = state.admin_audit_logs.slice().sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  ).slice(0, 20).map(entry => {
    const actor = state.users.find(person => person.id === entry.actor_id);
    return '<tr><td class="muted small">' + esc(entry.created_at || '—') + '</td>' +
      '<td>' + esc(actor?.full_name || 'Система') + '</td>' +
      '<td>' + esc(entry.action || '—') + '</td>' +
      '<td class="small">' + esc(entry.target_id || '—') + '</td>' +
      '<td class="small">' + esc(entry.reason || '—') + '</td></tr>';
  }).join('');
  sendHtml(res, layout('Модерация', user, flashBox(url) +
    '<div class="row-between"><div><h1>Центр модерации</h1><p class="muted">Автофильтр — это сигнал, а не доказательство нарушения. Решения остаются за администратором.</p></div><a class="btn btn-primary" href="/admin/ai">Помощник</a></div>' +
    metrics + search + '<h2 class="mt-2">Проверки и споры (' + cases.length + ')</h2>' +
    (caseHtml || '<div class="card"><p class="muted">Открытых проверок нет.</p></div>') +
    '<h2 class="mt-2">Жалобы пользователей (' + reports.length + ')</h2>' +
    (reportHtml || '<div class="card"><p class="muted">Открытых жалоб нет.</p></div>') +
    '<h2 class="mt-2">Журнал действий модераторов</h2>' +
    (auditRows ? '<div class="card" style="overflow-x:auto"><table><thead><tr><th>Дата</th><th>Администратор</th><th>Действие</th><th>Объект</th><th>Причина</th></tr></thead><tbody>' + auditRows + '</tbody></table></div>' :
      '<div class="card"><p class="muted">Действий пока нет.</p></div>')));
}

function handleModerationAction(res, user, params) {
  if (user.role !== 'admin') return redirect(res, '/');
  const item = state.moderation_cases.find(entry => entry.id === params.get('case_id') && entry.status === 'open');
  if (!item) return redirect(res, '/admin/moderation?error=notfound');
  const decision = params.get('decision');
  const now = new Date().toISOString();
  const messages = [];

  if (item.kind === 'post' || item.kind === 'listing') {
    if (!['approve', 'reject'].includes(decision)) return redirect(res, '/admin/moderation?error=decision');
    const post = item.kind === 'post' ? findPost(item.post_kind, item.target_id) : null;
    const listing = item.kind === 'listing' ? state.listings.find(x => x.id === item.target_id) : null;
    const target = post || listing;
    const canModerate = target && target.status === 'pending';
    if (canModerate) {
      target.status = decision === 'approve' ? 'active' : 'rejected';
      target.moderated_by = user.id;
      target.moderated_at = now;
      target.moderation_decision = decision;
      messages.push({ id: post ? post.user_id : listing.seller_id,
        title: decision === 'approve' ? 'Публикация одобрена' : 'Публикация отклонена',
        body: decision === 'approve' ? 'Публикация прошла ручную проверку.' : 'Публикация не прошла ручную проверку. При необходимости обратитесь к администрации.',
        href: item.kind === 'listing' ? '/market' : item.post_kind === 'offer' ? '/offers' : '/demand' });
    }
    item.decision = canModerate ? decision : 'target_missing_or_changed';
  } else if (item.kind === 'deal') {
    const deal = state.deals.find(entry => entry.id === item.target_id);
    if (!deal || deal.status !== 'disputed') return redirect(res, '/admin/moderation?error=deal_state');
    if (!['refund_buyer', 'release_seller'].includes(decision)) return redirect(res, '/admin/moderation?error=decision');

    const price = Number(deal.price || 0);
    if (!Number.isSafeInteger(price) || price < 0) return redirect(res, '/admin/moderation?error=deal_amount');
    const txKind = decision === 'refund_buyer' ? 'deal_dispute_refund' : 'deal_dispute_release';
    const ledgerState = dealLedgerState(deal);
    const previous = ledgerState.settlement;
    if (previous && ledgerState.decision !== decision) return redirect(res, '/admin/moderation?error=already_settled');

    if (price > 0 && !previous) {
      const held = ledgerState.held;
      if (!held || ledgerState.escrow !== price || held.balance < price) {
        return redirect(res, '/admin/moderation?error=escrow_mismatch');
      }
      try {
        if (decision === 'refund_buyer') {
          recordTx(txKind, user.id, { dealId: deal.id, amount: price, decision }, [
            { accountId: held.id, amount: -price, note: 'Возврат escrow после рассмотрения спора' },
            { accountId: account(deal.buyer_id, 'available').id, amount: price, note: 'Возврат заказчику после спора' }
          ]);
        } else {
          const commissionPercent = Math.min(100, Math.max(0, Number(deal.commission_percent) || 0));
          const commission = Math.floor(price * commissionPercent / 100);
          const entries = [
            { accountId: held.id, amount: -price, note: 'Разрешение спора в пользу исполнителя' },
            { accountId: account(deal.seller_id, 'available').id, amount: price - commission, note: 'Оплата после разрешения спора' }
          ];
          if (commission > 0) {
            const burn = systemAccount('burn');
            if (!burn) return redirect(res, '/admin/moderation?error=ledger');
            entries.push({ accountId: burn.id, amount: commission, note: 'Комиссия платформы' });
          }
          recordTx(txKind, user.id, { dealId: deal.id, amount: price, commission, decision }, entries);
        }
      } catch (error) {
        console.error('Moderation settlement failed:', error.message);
        return redirect(res, '/admin/moderation?error=settlement');
      }
    }

    deal.status = decision === 'refund_buyer' ? 'cancelled' : 'completed';
    deal.dispute_resolution = decision === 'refund_buyer' ? 'refunded_to_buyer' : 'released_to_seller';
    deal.dispute_resolved_by = user.id;
    deal.dispute_resolved_at = now;
    if (decision === 'release_seller') deal.completed_at = now;
    const post = findPost(deal.post_kind, deal.post_id);
    if (post && decision === 'release_seller') { post.status = 'completed'; post.updated_at = now; }
    else if (post && decision === 'refund_buyer' && post.status === 'in_progress') { post.status = 'active'; post.updated_at = now; }
    item.decision = decision;
    messages.push(
      { id: deal.buyer_id, title: 'Спор по сделке рассмотрен', body: decision === 'refund_buyer' ? 'Сделка отменена, зарезервированные ScRl возвращены.' : 'Администратор подтвердил завершение сделки.', href: '/deals' },
      { id: deal.seller_id, title: 'Спор по сделке рассмотрен', body: decision === 'refund_buyer' ? 'Сделка отменена после рассмотрения спора.' : 'Администратор подтвердил оплату по сделке.', href: '/deals' }
    );
  } else {
    return redirect(res, '/admin/moderation?error=case_kind');
  }

  item.status = 'resolved';
  item.resolved_by = user.id;
  item.resolved_at = now;
  item.resolution_note = decision;
  state.moderation_actions.push({ id: crypto.randomUUID(), case_id: item.id, admin_id: user.id, action: item.decision, created_at: now });
  audit(user, 'moderation_' + item.decision, item.target_id, item.reason);
  save();
  for (const message of messages) notify(message.id, 'moderation', message.title, message.body, message.href);
  return redirect(res, '/admin/moderation?msg=reviewed');
}

function handleReportAction(res, user, params) {
  if (user.role !== 'admin') return redirect(res, '/');
  const report = state.reports.find(item => item.id === params.get('report_id') && item.status === 'open');
  if (!report) return redirect(res, '/admin/moderation?error=notfound');
  const decision = params.get('decision');
  if (!['remove', 'dismiss'].includes(decision)) return redirect(res, '/admin/moderation?error=decision');
  const now = new Date().toISOString();
  const meta = reportMeta(report);
  const post = meta.targetType === 'post' ? findPost(meta.postKind, meta.postId) : null;
  const listing = meta.targetType === 'listing' ? state.listings.find(x => x.id === meta.listingId) : null;
  const target = post || listing;
  const messages = [];

  if (decision === 'remove' && target) {
    target.status = 'removed';
    target.moderated_by = user.id;
    target.moderated_at = now;
    target.moderation_decision = 'removed_after_report';
    target.updated_at = now;
    messages.push({ id: post ? post.user_id : listing.seller_id, title: 'Публикация скрыта модератором',
      body: 'Публикация скрыта после рассмотрения жалобы. Если вы считаете это ошибкой, обратитесь к администрации.',
      href: meta.targetType === 'listing' ? '/market' : meta.postKind === 'offer' ? '/offers' : '/demand' });
    for (const duplicate of state.reports.filter(x => {
      const value = reportMeta(x);
      const samePost = meta.targetType === 'post' && value.targetType === 'post' && value.postId === meta.postId && value.postKind === meta.postKind;
      const sameListing = meta.targetType === 'listing' && value.targetType === 'listing' && value.listingId === meta.listingId;
      return x.status === 'open' && (samePost || sameListing);
    })) {
      duplicate.status = 'action_taken';
      duplicate.reviewed_by = user.id;
      duplicate.reviewed_at = now;
      duplicate.decision = 'target_removed';
    }
    for (const relatedCase of state.moderation_cases.filter(entry =>
      entry.status === 'open' && (
        (meta.targetType === 'post' && entry.kind === 'post' && entry.target_id === meta.postId && entry.post_kind === meta.postKind) ||
        (meta.targetType === 'listing' && entry.kind === 'listing' && entry.target_id === meta.listingId)
      )
    )) {
      relatedCase.status = 'resolved';
      relatedCase.decision = 'removed_after_report';
      relatedCase.resolved_by = user.id;
      relatedCase.resolved_at = now;
    }
  } else {
    report.status = decision === 'remove' ? 'action_taken' : 'dismissed';
    report.reviewed_by = user.id;
    report.reviewed_at = now;
    report.decision = decision;
  }

  messages.push({ id: meta.reporterId, title: 'Жалоба рассмотрена',
    body: decision === 'dismiss' ? 'По результатам проверки оснований для удаления публикации не найдено.' :
      'Модератор рассмотрел жалобу и принял меры.', href: '/notifications' });
  state.moderation_actions.push({
    id: crypto.randomUUID(), case_id: null, report_id: report.id,
    admin_id: user.id, action: decision, target_id: meta.postId, created_at: now
  });
  audit(user, 'report_' + decision, meta.postId, report.reason);
  save();
  for (const message of messages) notify(message.id, 'moderation', message.title, message.body, message.href);
  return redirect(res, '/admin/moderation?msg=reviewed');
}

function answerAdminQuestion(question) {
  const q = String(question || '').toLowerCase();
  const posts = state.demand_posts.concat(state.offer_posts, state.listings);
  const pending = state.moderation_cases.filter(x => x.status === 'open').length;
  const reports = state.reports.filter(x => x.status === 'open').length;
  const disputes = state.deals.filter(x => x.status === 'disputed').length;
  const activeDeals = state.deals.filter(x => ['accepted', 'in_progress', 'awaiting_confirmation', 'disputed'].includes(x.status)).length;
  const activeAuctions = state.auctions.filter(x => x.status === 'active').length;
  const students = state.users.filter(x => x.role === 'student').length;
  const circulating = state.accounts.filter(x => x.user_id && ['available', 'held'].includes(x.kind)).reduce((sum, x) => sum + Number(x.balance || 0), 0);
  const flagged = posts.filter(x => x.status === 'pending').length;

  if (q.includes('жалоб') || q.includes('спор') || q.includes('модерац')) {
    return 'Очередь модерации:\n• Открытых проверок: ' + pending + '\n• Открытых жалоб: ' + reports + '\n• Спорных сделок: ' + disputes +
      '\n• Публикаций на ручной проверке: ' + flagged + '\n\nАвтопроверка подсказывает, но не принимает решение за администратора.';
  }
  if (q.includes('объяв') || q.includes('публикац') || q.includes('риск') || q.includes('провер')) {
    const matches = posts.filter(p => p.status === 'active' || p.status === 'pending')
      .map(post => ({ post, result: analyseText(post.title + '\n' + post.description) }))
      .filter(x => x.result.requiresReview).slice(0, 12);
    return 'Результат текстового скрининга:\n• Публикаций всего: ' + posts.length + '\n• На ручной проверке: ' + flagged +
      '\n• Найдено совпадений при повторной проверке: ' + matches.length + '\n' +
      (matches.map(x => '• «' + x.post.title + '» — ' + x.result.findings.map(f => f.label).join(', ')).join('\n') || 'Совпадений не найдено.') +
      '\n\nСовпадение — не доказательство нарушения.';
  }
  if (q.includes('аукцион')) return 'Активных внутренних аукционов ScRl: ' + activeAuctions + '. Денежные ставки и денежные призы не используются.';
  if (q.includes('эконом') || q.includes('баланс') || q.includes('токен')) {
    return 'Сводка экономики ScRl:\n• Учеников: ' + students + '\n• ScRl на пользовательских счетах: ' + circulating.toLocaleString('ru-RU') +
      '\n• Открытых сделок: ' + activeDeals + '\n• Активных аукционов: ' + activeAuctions + '\nRUB в этот подсчёт не включается.';
  }
  return 'Локальный помощник модератора может показать статистику жалоб и споров, повторно проверить публикации по локальным правилам и вывести сводку экономики. Внешний AI-провайдер не подключён; данные учеников не передаются сторонним сервисам.';
}

function pageAiChat(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const messages = state.ai_messages.filter(x => x.admin_id === user.id).slice(-40);
  const transcript = messages.map(x => '<div class="card" style="padding:12px"><b>' + (x.role === 'user' ? 'Вы' : 'ScRl Assistant') +
    '</b><p class="mt-1">' + esc(x.content).replace(/\n/g, '<br>') + '</p><span class="muted small">' +
    new Date(x.created_at).toLocaleString('ru-RU') + '</span></div>').join('');
  sendHtml(res, layout('AI Moderator', user,
    '<div class="row-between"><div><h1>AI Moderator</h1><p class="muted">Локальная аналитика и проверка по правилам, без внешнего AI-провайдера.</p></div><a class="btn btn-ghost btn-sm" href="/admin/moderation">К модерации</a></div>' +
    '<div class="alert alert-info">Помощник не банит пользователей и не принимает финансовые решения. Его выводы — рекомендации для человека.</div>' +
    (transcript || '<div class="card"><p class="muted">Попробуйте: «Сколько открытых жалоб?», «Покажи публикации с рисками», «Сводка экономики».</p></div>') +
    '<form class="card" method="POST" action="/admin/ai/chat"><label>Сообщение помощнику</label><textarea name="message" rows="3" maxlength="1000" required></textarea><button class="btn btn-primary">Отправить</button></form>'));
}

function handleAiChat(res, user, params) {
  if (user.role !== 'admin') return redirect(res, '/');
  const question = (params.get('message') || '').trim().slice(0, 1000);
  if (!question) return redirect(res, '/admin/ai?error=fields');
  const now = new Date().toISOString();
  state.ai_messages.push({ id: crypto.randomUUID(), admin_id: user.id, role: 'user', content: question, created_at: now });
  state.ai_messages.push({ id: crypto.randomUUID(), admin_id: user.id, role: 'assistant', content: answerAdminQuestion(question), created_at: new Date().toISOString() });
  save();
  return redirect(res, '/admin/ai');
}

module.exports = { pageModeration, handleModerationAction, handleReportAction, pageAiChat, handleAiChat, answerAdminQuestion };
