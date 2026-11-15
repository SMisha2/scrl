const crypto = require('node:crypto');
const { WEEKLY_LIMIT, DATA_FILE } = require('../config');
const { state, account, balance, systemAccount, recordTx, save } = require('../store');
const { ageStatus } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { getTokenMarketStats } = require('../services/token-market');
function pageTeacher(res, user, url) {
  if (user.role !== 'teacher') return redirect(res, '/');
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const issued = state.transactions
    .filter(t => t.kind === 'credit_teacher' && t.initiator_id === user.id && t.created_at > weekAgo)
    .reduce((s, t) => s + (t.payload.amount || 0), 0);
  const remaining = WEEKLY_LIMIT - issued;
  const students = state.users.filter(u => u.role === 'student' && u.class_name === user.class_name);
  const opts = students.map(s => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('');
  const rows = students.map(s => `<tr><td>${esc(s.full_name)}</td><td>${esc(s.class_name)}</td>
    <td style="text-align:right"><b>${balance(s.id, 'available')}</b> ScRl</td></tr>`).join('');
  sendHtml(res, layout('Учитель', user, `
    ${flashBox(url)}
    <h1>Кабинет учителя</h1>
    <div class="card">
      <div class="row-between"><span>Недельный лимит</span><span>Осталось <b>${remaining}</b> из ${WEEKLY_LIMIT}</span></div>
      <div class="progress"><div class="progress-bar" style="width:${Math.max(0, (remaining / WEEKLY_LIMIT) * 100)}%"></div></div>
    </div>
    <div class="card"><h2>Начислить токены</h2>
      <form method="POST" action="/teacher/issue">
        <div class="grid grid-2">
          <div><label>Ученик</label><select name="user_id" required><option value="">Выберите ученика</option>${opts}</select></div>
          <div><label>Сумма, ScRl</label><input name="amount" type="number" min="1" max="${remaining}" required></div>
        </div>
        <label>Причина</label><select name="reason">
          <option>Помощь другим</option><option>Академические достижения</option>
          <option>Проект</option><option>Инициатива</option><option>Другое</option>
        </select>
        <button class="btn btn-primary">Начислить</button>
      </form>
    </div>
    <div class="card"><h2>Ученики класса ${esc(user.class_name || '')}</h2>
      ${rows ? `<table><thead><tr><th>Ученик</th><th>Класс</th><th style="text-align:right">Баланс</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">Нет учеников в вашем классе</p>'}
    </div>`));
}


function handleIssue(res, user, params) {
  if (user.role !== 'teacher') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = Number(params.get('amount') || 0);
  const reason = (params.get('reason') || 'Другое').trim().slice(0, 180) || 'Другое';
  const student = state.users.find(item => item.id === userId && item.role === 'student' && item.class_name === user.class_name);
  if (!student || !Number.isSafeInteger(amount) || amount < 1 || amount > WEEKLY_LIMIT) {
    return redirect(res, '/teacher?error=fields');
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const issued = state.transactions
    .filter(tx => tx.kind === 'credit_teacher' && tx.initiator_id === user.id && tx.created_at > weekAgo)
    .reduce((sum, tx) => sum + Number(tx.payload?.amount || 0), 0);
  if (issued + amount > WEEKLY_LIMIT) return redirect(res, '/teacher?error=limit');

  const reserve = systemAccount('reserve');
  if (!reserve) return redirect(res, '/teacher?error=ledger');
  try {
    recordTx('credit_teacher', user.id, { amount, reason, studentId: userId }, [
      { accountId: reserve.id, amount: -amount, note: reason },
      { accountId: account(userId, 'available').id, amount, note: reason }
    ]);
  } catch (error) {
    console.error('Teacher credit failed:', error.message);
    return redirect(res, error.code === 'backing_limit' ? '/teacher?error=backing_limit' : '/teacher?error=ledger');
  }
  return redirect(res, '/teacher?msg=issued');
}




function pageAdmin(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');

  const students = state.users.filter(person => person.role === 'student');
  const studentIds = new Set(students.map(person => person.id));
  const market = getTokenMarketStats();
  const circulating = market.circulatingScRl;
  const held = state.accounts
    .filter(item => studentIds.has(item.user_id) && item.kind === 'held')
    .reduce((sum, item) => sum + Math.max(0, Number(item.balance) || 0), 0);
  const available = Math.max(0, circulating - held);
  const burnAccount = systemAccount('burn');
  const reserveAccount = systemAccount('reserve');
  const burned = Math.max(0, Number(burnAccount && burnAccount.balance) || 0);
  const reserve = Math.max(0, Number(reserveAccount && reserveAccount.balance) || 0);
  const money = value => Math.max(0, Number(value) || 0).toLocaleString('ru-RU');
  const totalIssued = state.transactions
    .filter(tx => ['signup_bonus', 'credit_teacher', 'credit_admin'].includes(tx.kind))
    .reduce((sum, tx) => sum + Math.max(0, Number(tx.payload && tx.payload.amount) || 0), 0);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const activeStudents = new Set(
    state.transactions
      .filter(tx => tx.created_at > weekAgo && studentIds.has(tx.initiator_id))
      .map(tx => tx.initiator_id)
  ).size;
  const transactions24h = state.transactions.filter(tx => tx.created_at > dayAgo).length;

  const labels = {
    signup_bonus: 'Стартовый бонус',
    credit_teacher: 'Начисление учителя',
    credit_admin: 'Начисление школы',
    debit_admin: 'Списание школой',
    transfer: 'Перевод',
    deal_escrow: 'Резерв по сделке',
    deal_settlement: 'Оплата за помощь',
    deal_escrow_refund: 'Возврат оплаты',
    deal_dispute_refund: 'Возврат после спора',
    deal_dispute_release: 'Выплата после спора',
    exchange_hold: 'Заявка на обмен',
    exchange_vrub_hold: 'Заявка на обмен V-RUB',
    exchange_cancel: 'Отмена заявки',
    exchange_vrub_cancel: 'Возврат заявки V-RUB',
    exchange_trade: 'Обмен на бирже',
    exchange_trade_vrub: 'Обмен V-RUB',
    burn_commission: 'Комиссия сожжена'
  };
  const recentTx = state.transactions
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 15)
    .map(tx => {
      const initiator = state.users.find(person => person.id === tx.initiator_id);
      const payload = tx.payload && typeof tx.payload === 'object' ? tx.payload : {};
      const rawAmount = payload.amount ?? payload.price ?? payload.amountScRl ??
        payload.amount_scrl ?? payload.sc_rl_amount ?? payload.scrlAmount ?? 0;
      const amount = Number(rawAmount);
      const unit = tx.kind === 'exchange_trade_vrub' ? 'V-RUB' : 'ScRl';
      const amountText = Number.isFinite(amount) && amount > 0
        ? money(amount) + ' ' + unit
        : 'Не указана';
      return '<tr>' +
        '<td class="muted small">' + esc(tx.created_at ? new Date(tx.created_at).toLocaleString('ru-RU') : 'Не указано') + '</td>' +
        '<td>' + esc(labels[tx.kind] || 'Операция') + '</td>' +
        '<td>' + esc(initiator ? initiator.full_name : 'Система') + '</td>' +
        '<td class="economy-amount">' + esc(amountText) + '</td>' +
      '</tr>';
    }).join('');

  const dataDirConfigured = Boolean(process.env.SCRL_DATA_DIR && process.env.SCRL_DATA_DIR.trim());
  const storageTitle = dataDirConfigured ? 'Каталог задан' : 'Обычный каталог приложения';
  const storageNote = dataDirConfigured
    ? 'Проверьте, что Render Disk смонтирован именно в этот путь.'
    : 'На Render этот файл пропадает при новом деплое. Для постоянного хранения нужен Render Disk и переменная SCRL_DATA_DIR.';

  sendHtml(res, layout('Экономика ScRl', user, flashBox(url) +
    '<header class="economy-header">' +
      '<div><h1>Экономика ScRl</h1><p>Состояние счетов и последние операции.</p></div>' +
      '<div class="economy-updated">Обновлено ' + new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '</div>' +
    '</header>' +
    '<section class="economy-overview" aria-label="Состояние экономики">' +
      '<div class="economy-primary">' +
        '<span class="economy-label">ScRl в обращении</span>' +
        '<strong>' + money(circulating) + '</strong>' +
        '<span class="economy-unit">ScRl</span>' +
        '<p>' + money(held) + ' ScRl заблокировано у участников</p>' +
      '</div>' +
      '<dl class="economy-facts">' +
        '<div><dt>Доступно ученикам</dt><dd>' + money(available) + ' ScRl</dd></div>' +
        '<div><dt>Всего начислено</dt><dd>' + money(totalIssued) + ' ScRl</dd></div>' +
        '<div><dt>Системный резерв</dt><dd>' + money(reserve) + ' ScRl</dd></div>' +
        '<div><dt>Сожжено</dt><dd>' + money(burned) + ' ScRl</dd></div>' +
        '<div><dt>V-RUB у учеников</dt><dd>' + money(market.virtualRubleSupply) + '</dd></div>' +
        '<div><dt>Целевой курс</dt><dd>1 ScRl = ' + Number(market.targetRate).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' V-RUB</dd></div>' +
        '<div><dt>Текущее соотношение</dt><dd>' + Number(market.referenceRate).toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) + ' V-RUB</dd></div>' +
      '</dl>' +
    '</section>' +
    '<section class="economy-activity" aria-label="Активность">' +
      '<div><strong>' + money(state.users.length) + '</strong><span>Пользователей</span></div>' +
      '<div><strong>' + money(activeStudents) + '</strong><span>Учеников с операциями за 7 дней</span></div>' +
      '<div><strong>' + money(transactions24h) + '</strong><span>Операций за сутки</span></div>' +
    '</section>' +
    '<nav class="economy-actions" aria-label="Разделы администратора">' +
      '<a href="/admin/users">Пользователи</a>' +
      '<a href="/admin/impact">Пульс лицея</a>' +
      '<a href="/admin/market">Курс ScRl</a>' +
      '<a href="/admin/moderation">Модерация</a>' +
      '<a href="/admin/ai">AI-помощник</a>' +
      '<a href="/admin/financial">Финансы</a>' +
    '</nav>' +
    '<section class="economy-transactions">' +
      '<div class="economy-section-heading"><h2>Последние операции</h2><span>15 последних записей</span></div>' +
      (recentTx
        ? '<table class="economy-table"><thead><tr><th>Время</th><th>Операция</th><th>Участник</th><th>Сумма</th></tr></thead><tbody>' + recentTx + '</tbody></table>'
        : '<p class="muted">Операций пока нет.</p>') +
    '</section>' +
    '<section class="economy-storage">' +
      '<div><span class="economy-label">Файл данных</span><code>' + esc(DATA_FILE) + '</code></div>' +
      '<div><strong>' + esc(storageTitle) + '</strong><p>' + esc(storageNote) + '</p></div>' +
    '</section>'
  ));
}

function pageAdminUsers(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const cards = state.users.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(u => {
    const av = balance(u.id, 'available');
    const hd = balance(u.id, 'held');
    const vr = u.role === 'student' ? balance(u.id, 'vrub') : null;
    const actions = u.role === 'student' ? `
      <div class="mt-2 row">
        <form method="POST" action="/admin/credit" class="row">
          <input type="hidden" name="user_id" value="${u.id}">
          <input name="amount" type="number" min="1" required placeholder="+" style="width:70px;margin:0">
          <input name="reason" required placeholder="причина" style="width:140px;margin:0">
          <button class="btn btn-primary btn-sm">Начислить</button>
        </form>
        <form method="POST" action="/admin/debit" class="row">
          <input type="hidden" name="user_id" value="${u.id}">
          <input name="amount" type="number" min="1" required placeholder="−" style="width:70px;margin:0">
          <input name="reason" required placeholder="причина" style="width:140px;margin:0">
          <button class="btn btn-danger btn-sm">Списать</button>
        </form>
        <form method="POST" action="/admin/block" class="row">
          <input type="hidden" name="user_id" value="${u.id}">
          <input type="hidden" name="block" value="${u.is_blocked ? '0' : '1'}">
          <input name="reason" maxlength="300" required placeholder="${u.is_blocked ? 'Причина разблокировки' : 'Причина блокировки'}" style="width:190px;margin:0">
          <button class="btn btn-ghost btn-sm">${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button>
        </form>
      </div>` : '';
    return `<div class="card">
      <div class="row-between">
        <div><b>${esc(u.full_name)}</b>
          <div class="muted small">${esc(u.email)} · ${u.role}${u.birth_date ? ' · ' + ageStatus(u.birth_date) : ''}${u.class_name ? ' · ' + esc(u.class_name) : ''}${u.is_blocked ? ' · <span class="badge badge-danger">Заблокирован</span> · Причина: ' + esc(u.block_reason || 'Не указана') : ''}</div>
        </div>
        <div style="text-align:right"><div><b>${av}</b> ScRl</div>
          <div class="muted small">${hd} в escrow${vr !== null ? ' · ' + vr + ' vrub' : ''}</div></div>
      </div>
      ${actions}
    </div>`;
  }).join('');
  sendHtml(res, layout('Пользователи', user, `
    ${flashBox(url)}
    <div class="row-between"><h1>Пользователи</h1><a href="/admin" class="btn btn-ghost btn-sm">← Назад</a></div>
    ${cards}`));
}


function handleCredit(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = Number(params.get('amount') || 0);
  const reason = (params.get('reason') || '').trim().slice(0, 180);
  const student = state.users.find(item => item.id === userId && item.role === 'student');
  if (!student || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000 || !reason) {
    return redirect(res, '/admin/users?error=fields');
  }
  const reserve = systemAccount('reserve');
  if (!reserve) return redirect(res, '/admin/users?error=ledger');
  try {
    recordTx('credit_admin', admin.id, { amount, reason, target: userId }, [
      { accountId: reserve.id, amount: -amount, note: reason },
      { accountId: account(userId, 'available').id, amount, note: reason }
    ]);
  } catch (error) {
    console.error('Admin credit failed:', error.message);
    return redirect(res, error.code === 'backing_limit' ? '/admin/users?error=backing_limit' : '/admin/users?error=ledger');
  }
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: admin.id,
    action: 'student_credit_admin', target_id: userId, reason,
    created_at: new Date().toISOString()
  });
  save();
  return redirect(res, '/admin/users?msg=credited');
}




function handleDebit(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = Number(params.get('amount') || 0);
  const reason = (params.get('reason') || '').trim().slice(0, 180);
  const student = state.users.find(item => item.id === userId && item.role === 'student');
  if (!student || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000 || !reason) {
    return redirect(res, '/admin/users?error=fields');
  }
  const reserve = systemAccount('reserve');
  if (!reserve) return redirect(res, '/admin/users?error=ledger');
  try {
    recordTx('debit_admin', admin.id, { amount, reason, target: userId }, [
      { accountId: account(userId, 'available').id, amount: -amount, note: reason },
      { accountId: reserve.id, amount, note: reason }
    ]);
  } catch (error) {
    console.error('Admin debit failed:', error.message);
    return redirect(res, '/admin/users?error=insufficient');
  }
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: admin.id,
    action: 'student_debit_admin', target_id: userId, reason,
    created_at: new Date().toISOString()
  });
  save();
  return redirect(res, '/admin/users?msg=debited');
}




function handleBlock(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const target = state.users.find(item => item.id === userId);
  if (!target) return redirect(res, '/admin/users?error=notfound');
  if (target.id === admin.id || target.role === 'admin') return redirect(res, '/admin/users?error=bad');

  const reason = (params.get('reason') || '').trim().slice(0, 300);
  if (!reason) return redirect(res, '/admin/users?error=fields');

  const block = params.get('block') === '1';
  const now = new Date().toISOString();
  target.is_blocked = block;
  if (block) {
    target.blocked_by = admin.id;
    target.blocked_at = now;
    target.block_reason = reason;
  } else {
    target.unblocked_by = admin.id;
    target.unblocked_at = now;
    target.unblock_reason = reason;
    target.blocked_by = null;
    target.blocked_at = null;
    target.block_reason = null;
  }
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: admin.id,
    action: block ? 'user_blocked' : 'user_unblocked',
    target_id: target.id, reason, created_at: now
  });
  save();
  return redirect(res, '/admin/users?msg=' + (block ? 'blocked' : 'unblocked'));
}


module.exports = { pageTeacher, handleIssue, pageAdmin, pageAdminUsers, handleCredit, handleDebit, handleBlock };
