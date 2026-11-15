const crypto = require('node:crypto');
const { WEEKLY_LIMIT, DATA_FILE } = require('../config');
const { state, account, balance, systemAccount, recordTx, save } = require('../store');
const { ageStatus } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { getTokenMarketStats } = require('../services/token-market');
const { sessions } = require('../session');
const { hashPassword } = require('../security');
const { changeUserRole, anonymizeUser } = require('../services/user-admin');
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

  const showDeleted = url.searchParams.get('show') === 'deleted';
  const roleFilter = url.searchParams.get('role') || 'all';
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 80).toLocaleLowerCase('ru-RU');
  const activeUsers = state.users.filter(person => !person.deleted_at && person.role !== 'deleted');
  const studentsCount = activeUsers.filter(person => person.role === 'student').length;
  const teachersCount = activeUsers.filter(person => person.role === 'teacher').length;
  const blockedCount = activeUsers.filter(person => person.is_blocked).length;
  const deletedCount = state.users.filter(person => person.deleted_at || person.role === 'deleted').length;
  const money = value => Math.max(0, Number(value) || 0).toLocaleString('ru-RU');

  const visibleUsers = state.users
    .filter(person => showDeleted
      ? Boolean(person.deleted_at || person.role === 'deleted')
      : !person.deleted_at && person.role !== 'deleted')
    .filter(person => {
      if (showDeleted || roleFilter === 'all') return true;
      if (roleFilter === 'blocked') return Boolean(person.is_blocked);
      return person.role === roleFilter;
    })
    .filter(person => {
      if (!query) return true;
      return [person.full_name, person.email, person.class_name]
        .some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const roleNames = { student: 'Ученик', teacher: 'Учитель', admin: 'Администратор', deleted: 'Удалён' };
  const cards = visibleUsers.map(person => {
    const av = balance(person.id, 'available');
    const held = balance(person.id, 'held');
    const vrub = person.role === 'student' ? balance(person.id, 'vrub') : null;
    const details = [
      esc(person.email || ''),
      roleNames[person.role] || 'Участник',
      person.class_name ? 'Класс ' + esc(person.class_name) : '',
      person.birth_date ? ageStatus(person.birth_date) : ''
    ].filter(Boolean).join(' · ');
    const status = person.deleted_at
      ? '<span class="badge badge-muted">Удалён</span>'
      : person.is_blocked
        ? '<span class="badge badge-danger">Заблокирован</span>'
        : '<span class="badge badge-success">Активен</span>';
    let actions = '';
    if (person.deleted_at || person.role === 'deleted') {
      actions = '<p class="muted small mt-2">Профиль обезличен. Балансы, операции и история сделок сохранены для учёта.</p>';
    } else if (person.role === 'admin') {
      actions = '<p class="muted small mt-2">Права администратора меняются только через отдельную настройку доступа.</p>';
    } else {
      const roleForm =
        '<form method="POST" action="/admin/role" class="admin-user-form">' +
          '<input type="hidden" name="user_id" value="' + esc(person.id) + '">' +
          '<label>Роль</label><select name="role">' +
            '<option value="student"' + (person.role === 'student' ? ' selected' : '') + '>Ученик</option>' +
            '<option value="teacher"' + (person.role === 'teacher' ? ' selected' : '') + '>Учитель</option>' +
          '</select>' +
          '<label>Класс для кабинета учителя</label><input name="class_name" maxlength="20" value="' + esc(person.class_name || '') + '" placeholder="Например, 8А">' +
          '<button class="btn btn-primary btn-sm">Сохранить роль</button>' +
        '</form>';
      const blockForm =
        '<form method="POST" action="/admin/block" class="admin-user-form">' +
          '<input type="hidden" name="user_id" value="' + esc(person.id) + '">' +
          '<input type="hidden" name="block" value="' + (person.is_blocked ? '0' : '1') + '">' +
          '<label>' + (person.is_blocked ? 'Причина разблокировки' : 'Причина блокировки') + '</label>' +
          '<input name="reason" maxlength="300" required placeholder="Коротко укажите причину">' +
          '<button class="btn btn-ghost btn-sm">' + (person.is_blocked ? 'Разблокировать' : 'Заблокировать') + '</button>' +
        '</form>';
      const moneyForms = person.role === 'student'
        ? '<div class="admin-user-form"><form method="POST" action="/admin/credit">' +
            '<input type="hidden" name="user_id" value="' + esc(person.id) + '">' +
            '<label>Начислить ScRl</label><input name="amount" type="number" min="1" max="1000000" required placeholder="Сумма">' +
            '<input name="reason" maxlength="180" required placeholder="Причина">' +
            '<button class="btn btn-primary btn-sm">Начислить</button></form>' +
          '</div><div class="admin-user-form"><form method="POST" action="/admin/debit">' +
            '<input type="hidden" name="user_id" value="' + esc(person.id) + '">' +
            '<label>Списать ScRl</label><input name="amount" type="number" min="1" max="1000000" required placeholder="Сумма">' +
            '<input name="reason" maxlength="180" required placeholder="Причина">' +
            '<button class="btn btn-ghost btn-sm">Списать</button></form></div>'
        : '';
      const deleteForm =
        '<details class="admin-delete"><summary>Удалить аккаунт</summary>' +
          '<p class="muted small">Профиль и вход будут удалены. Активные объявления закроются. Финансовая история и данные завершённых сделок останутся в обезличенном виде.</p>' +
          '<form method="POST" action="/admin/delete">' +
            '<input type="hidden" name="user_id" value="' + esc(person.id) + '">' +
            '<label>Причина удаления</label><input name="reason" maxlength="300" required placeholder="Укажите причину">' +
            '<label>Для подтверждения введите УДАЛИТЬ</label><input name="confirmation" required autocomplete="off" placeholder="УДАЛИТЬ">' +
            '<button class="btn btn-danger btn-sm">Удалить аккаунт</button>' +
          '</form></details>';
      actions = '<details class="admin-user-actions"><summary>Управление</summary><div class="admin-user-actions-body">' +
        roleForm + blockForm + moneyForms + deleteForm + '</div></details>';
    }
    return '<article class="card admin-user-row">' +
      '<div class="row-between admin-user-heading"><div><b>' + esc(person.full_name || 'Участник') + '</b>' +
      '<div class="muted small">' + details + '</div></div>' +
      '<div class="admin-user-balance"><b>' + money(av) + ' ScRl</b><div class="muted small">' +
      money(held) + ' в резерве' + (vrub !== null ? ' · ' + money(vrub) + ' V-RUB' : '') + '</div></div></div>' +
      '<div class="admin-user-meta">' + status +
      (person.is_blocked && !person.deleted_at ? '<span class="muted small">Причина: ' + esc(person.block_reason || 'не указана') + '</span>' : '') +
      '</div>' + actions + '</article>';
  }).join('');

  const queryValue = esc(url.searchParams.get('q') || '');
  const tabs = showDeleted
    ? '<a href="/admin/users">Назад к участникам</a>'
    : '<nav class="admin-user-filters">' +
      '<a href="/admin/users?role=all">Все (' + activeUsers.length + ')</a>' +
      '<a href="/admin/users?role=student">Ученики (' + studentsCount + ')</a>' +
      '<a href="/admin/users?role=teacher">Учителя (' + teachersCount + ')</a>' +
      '<a href="/admin/users?role=blocked">Заблокированные (' + blockedCount + ')</a>' +
      '<a href="/admin/users?show=deleted">Удалённые (' + deletedCount + ')</a>' +
      '</nav>';
  const auditLabels = {
    user_role_changed: 'Изменение роли',
    user_deleted: 'Удаление аккаунта',
    user_blocked: 'Блокировка',
    user_unblocked: 'Снятие блокировки',
    student_credit_admin: 'Начисление ScRl',
    student_debit_admin: 'Списание ScRl'
  };
  const history = (state.admin_audit_logs || []).slice().sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 20).map(entry => {
      const actor = state.users.find(item => item.id === entry.actor_id);
      const target = state.users.find(item => item.id === entry.target_id);
      return '<tr><td>' + esc(entry.created_at ? new Date(entry.created_at).toLocaleString('ru-RU') : '') +
        '</td><td>' + esc(auditLabels[entry.action] || 'Действие') +
        '</td><td>' + esc(actor ? actor.full_name : 'Неизвестно') +
        '</td><td>' + esc(target ? target.full_name : 'Удалённая запись') +
        '</td><td>' + esc(entry.reason || '') + '</td></tr>';
    }).join('');

  sendHtml(res, layout('Пользователи', user,
    flashBox(url) +
    '<header class="admin-users-header"><div><h1>Участники</h1><p class="muted">Роли, классы и доступ к ScRl.</p></div>' +
    '<a href="/admin" class="btn btn-ghost btn-sm">К экономике</a></header>' +
    tabs +
    (showDeleted ? '' :
      '<form method="GET" action="/admin/users" class="admin-user-search">' +
      '<input name="q" value="' + queryValue + '" maxlength="80" placeholder="Имя, email или класс">' +
      '<input type="hidden" name="role" value="' + esc(roleFilter) + '">' +
      '<button class="btn btn-primary btn-sm">Найти</button>' +
      (queryValue ? '<a class="btn btn-ghost btn-sm" href="/admin/users?role=' + encodeURIComponent(roleFilter) + '">Сбросить</a>' : '') +
      '</form>') +
    '<p class="muted small">' + (showDeleted ? 'Архив удалённых аккаунтов: ' : 'Найдено: ') + visibleUsers.length + '</p>' +
    (cards || '<p class="muted">Здесь пока нет пользователей.</p>') +
    '<details class="admin-user-history"><summary>Последние действия администраторов</summary>' +
    (history ? '<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Действие</th><th>Кто</th><th>Кому</th><th>Причина</th></tr></thead><tbody>' + history + '</tbody></table></div>' :
      '<p class="muted small">Записей пока нет.</p>') +
    '</details>'
  ));
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



function handleRole(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const target = state.users.find(item => item.id === userId);
  if (!target || target.id === admin.id || target.role === 'admin') {
    return redirect(res, '/admin/users?error=protected');
  }
  const nextRole = params.get('role');
  const className = (params.get('class_name') || '').trim();
  let result;
  try {
    result = changeUserRole(target, nextRole, className);
  } catch (error) {
    return redirect(res, '/admin/users?error=' + (error.code === 'teacher_class' ? 'teacher_class' : 'protected'));
  }
  const now = new Date().toISOString();
  for (const [token, session] of sessions) {
    const sessionUserId = typeof session === 'string' ? session : session && session.userId;
    if (sessionUserId === target.id) sessions.delete(token);
  }
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: admin.id, action: 'user_role_changed',
    target_id: target.id, from_role: result.previousRole, to_role: result.role,
    class_name: result.className, reason: 'Роль и класс изменены администратором', created_at: now
  });
  save();
  return redirect(res, '/admin/users?msg=role_changed');
}

function handleDeleteUser(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const target = state.users.find(item => item.id === params.get('user_id'));
  if (!target || target.id === admin.id || target.role === 'admin' || target.deleted_at) {
    return redirect(res, '/admin/users?error=protected');
  }
  const reason = (params.get('reason') || '').trim().slice(0, 300);
  if (!reason) return redirect(res, '/admin/users?error=fields');
  if (params.get('confirmation') !== 'УДАЛИТЬ') {
    return redirect(res, '/admin/users?error=confirmation');
  }

  const now = new Date().toISOString();
  try {
    anonymizeUser(target, {
      actorId: admin.id,
      reason,
      now,
      passwordHash: hashPassword(crypto.randomBytes(48).toString('hex'))
    });
  } catch (error) {
    return redirect(res, '/admin/users?error=protected');
  }

  for (const [token, session] of sessions) {
    const sessionUserId = typeof session === 'string' ? session : session && session.userId;
    if (sessionUserId === target.id) sessions.delete(token);
  }
  for (const post of [...(state.demand_posts || []), ...(state.offer_posts || [])]) {
    if (post.user_id === target.id && ['active', 'pending'].includes(post.status)) {
      post.status = 'removed';
      post.removed_at = now;
      post.removed_by = admin.id;
    }
  }
  for (const listing of (state.listings || [])) {
    if (listing.seller_id === target.id && ['active', 'pending'].includes(listing.status)) {
      listing.status = 'removed';
      listing.removed_at = now;
      listing.removed_by = admin.id;
    }
  }
  state.admin_audit_logs.push({
    id: crypto.randomUUID(), actor_id: admin.id, action: 'user_deleted',
    target_id: target.id, reason, created_at: now
  });
  save();
  return redirect(res, '/admin/users?msg=user_deleted');
}

module.exports = { pageTeacher, handleIssue, pageAdmin, pageAdminUsers, handleCredit, handleDebit, handleBlock, handleRole, handleDeleteUser };
