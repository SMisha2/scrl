const { WEEKLY_LIMIT } = require('../config');
const { state, account, balance, systemAccount, recordTx, save } = require('../store');
const { ageStatus } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
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
          <div><label>Ученик</label><select name="user_id" required><option value="">— выберите —</option>${opts}</select></div>
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
  const amount = parseInt(params.get('amount') || '0', 10);
  const reason = params.get('reason') || 'Другое';
  const student = state.users.find(u => u.id === userId && u.role === 'student');
  if (!student || !amount || amount < 1) return redirect(res, '/teacher?error=fields');
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const issued = state.transactions
    .filter(t => t.kind === 'credit_teacher' && t.initiator_id === user.id && t.created_at > weekAgo)
    .reduce((s, t) => s + (t.payload.amount || 0), 0);
  if (issued + amount > WEEKLY_LIMIT) return redirect(res, '/teacher?error=limit');
  recordTx('credit_teacher', user.id, { amount, reason, studentId: userId }, [
    { accountId: systemAccount('reserve').id, amount: -amount },
    { accountId: account(userId, 'available').id, amount }
  ]);
  redirect(res, '/teacher?msg=issued');
}


function pageAdmin(res, user, url) {
  if (user.role !== 'admin') return redirect(res, '/');
  const totalIssued = state.transactions
    .filter(t => ['signup_bonus', 'credit_teacher', 'credit_admin'].includes(t.kind))
    .reduce((s, t) => s + (t.payload.amount || 0), 0);
  const circulating = state.accounts
    .filter(a => a.user_id && (a.kind === 'available' || a.kind === 'held'))
    .reduce((s, a) => s + a.balance, 0);
  const held = state.accounts.filter(a => a.user_id && a.kind === 'held').reduce((s, a) => s + a.balance, 0);
  const burned = systemAccount('burn').balance;
  const reserve = systemAccount('reserve').balance;
  const totalUsers = state.users.length;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const activeUsers = new Set(state.transactions.filter(t => t.created_at > weekAgo && t.initiator_id).map(t => t.initiator_id)).size;
  const tx24h = state.transactions.filter(t => t.created_at > new Date(Date.now() - 24 * 3600 * 1000).toISOString()).length;
  const recentTx = state.transactions.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15).map(t => {
    const init = state.users.find(u => u.id === t.initiator_id);
    return `<tr><td class="muted small">${new Date(t.created_at).toLocaleString('ru-RU')}</td>
      <td>${esc(t.kind)}</td><td>${esc(init ? init.full_name : 'system')}</td>
      <td class="muted small">${esc(JSON.stringify(t.payload))}</td></tr>`;
  }).join('');
  const m = (label, value, accent) => `<div class="card ${accent ? 'balance' : ''}">
    <div class="muted small">${label}</div>
    <div class="metric"><div class="value">${value.toLocaleString('ru-RU')}</div></div></div>`;
  sendHtml(res, layout('Монитор', user, `
    ${flashBox(url)}
    <h1>Economy Monitor</h1>
    <div class="grid grid-4">
      ${m('Total Issued', totalIssued)}
      ${m('Circulating', circulating)}
      ${m('Held (escrow)', held)}
      ${m('Total Burned', burned, true)}
      ${m('Reserve', reserve)}
      ${m('Users', totalUsers)}
      ${m('Active (7d)', activeUsers)}
      ${m('Tx (24h)', tx24h)}
    </div>
    <div class="mt-2"><a href="/admin/users" class="btn btn-primary">Пользователи →</a></div>
    <div class="card mt-2"><h2>Последние транзакции</h2>
      <table><thead><tr><th>Дата</th><th>Тип</th><th>Инициатор</th><th>Payload</th></tr></thead><tbody>${recentTx}</tbody></table>
    </div>`));
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
        <form method="POST" action="/admin/block">
          <input type="hidden" name="user_id" value="${u.id}">
          <input type="hidden" name="block" value="${u.is_blocked ? '0' : '1'}">
          <button class="btn btn-ghost btn-sm">${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button>
        </form>
      </div>` : '';
    return `<div class="card">
      <div class="row-between">
        <div><b>${esc(u.full_name)}</b>
          <div class="muted small">${esc(u.email)} · ${u.role}${u.birth_date ? ' · ' + ageStatus(u.birth_date) : ''}${u.class_name ? ' · ' + esc(u.class_name) : ''}${u.is_blocked ? ' · <span class="badge badge-danger">Заблокирован</span>' : ''}</div>
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
  const amount = parseInt(params.get('amount') || '0', 10);
  const reason = (params.get('reason') || '').trim();
  if (!userId || !amount || amount < 1 || !reason) return redirect(res, '/admin/users?error=fields');
  recordTx('credit_admin', admin.id, { amount, reason, target: userId }, [
    { accountId: systemAccount('reserve').id, amount: -amount },
    { accountId: account(userId, 'available').id, amount }
  ]);
  redirect(res, '/admin/users?msg=credited');
}


function handleDebit(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  const amount = parseInt(params.get('amount') || '0', 10);
  const reason = (params.get('reason') || '').trim();
  if (!userId || !amount || amount < 1 || !reason) return redirect(res, '/admin/users?error=fields');
  try {
    recordTx('debit_admin', admin.id, { amount, reason, target: userId }, [
      { accountId: account(userId, 'available').id, amount: -amount, note: reason },
      { accountId: systemAccount('reserve').id, amount, note: reason }
    ]);
  } catch (e) {
    return redirect(res, '/admin/users?error=insufficient');
  }
  redirect(res, '/admin/users?msg=debited');
}


function handleBlock(res, admin, params) {
  if (admin.role !== 'admin') return redirect(res, '/');
  const userId = params.get('user_id');
  if (userId === admin.id) return redirect(res, '/admin/users?error=bad');
  const block = params.get('block') === '1';
  const u = state.users.find(x => x.id === userId);
  if (!u) return redirect(res, '/admin/users?error=notfound');
  u.is_blocked = block;
  save();
  redirect(res, `/admin/users?msg=${block ? 'blocked' : 'unblocked'}`);
}


module.exports = { pageTeacher, handleIssue, pageAdmin, pageAdminUsers, handleCredit, handleDebit, handleBlock };
