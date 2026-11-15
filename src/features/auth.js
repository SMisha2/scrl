const crypto = require('node:crypto');
const { SESSION_MAX_AGE } = require('../config');
const { state, account, systemAccount, save, recordTx, grantStartingVrub } = require('../store');
const { getTokenMarketStats, calculateSignupBonusScRl } = require('../services/token-market');
const { hashPassword, verifyPassword } = require('../security');
const { sessions, parseCookies, sessionRecord, ageStatus } = require('../session');
const { sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');

const DEMO_MODE = process.env.SCRL_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 6;
const loginFailures = new Map();

function loginRateLimited(req, email) {
  const ip = String(req.socket?.remoteAddress || 'unknown').slice(0, 80);
  const key = ip + '|' + email;
  const now = Date.now();
  const record = loginFailures.get(key);
  if (!record) return false;
  if (record.blockedUntil > now) return true;
  if (now - record.windowStart >= LOGIN_WINDOW_MS) loginFailures.delete(key);
  return false;
}

function recordLoginFailure(req, email) {
  const ip = String(req.socket?.remoteAddress || 'unknown').slice(0, 80);
  const key = ip + '|' + email;
  const now = Date.now();
  const old = loginFailures.get(key);
  const record = !old || now - old.windowStart >= LOGIN_WINDOW_MS
    ? { count: 0, windowStart: now, blockedUntil: 0 }
    : old;
  record.count += 1;
  if (record.count >= LOGIN_MAX_ATTEMPTS) record.blockedUntil = now + LOGIN_WINDOW_MS;
  loginFailures.set(key, record);
  if (loginFailures.size > 5000) {
    for (const [entryKey, entry] of loginFailures) {
      if (now - entry.windowStart > LOGIN_WINDOW_MS && entry.blockedUntil <= now) loginFailures.delete(entryKey);
    }
  }
}


function sessionCookie(req, token, maxAge) {
  const secure = Boolean(req.socket && req.socket.encrypted) ||
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return 'scrl_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

function pageLogin(res, user, url, staffOnly = false) {
  if (user) return redirect(res, '/');
  const action = staffOnly ? '/staff/login' : '/login';
  const title = staffOnly ? 'Вход для сотрудников' : 'Вход';
  const quickUsers = staffOnly
    ? [['teacher@scrl.demo', 'Учитель'], ['admin@scrl.demo', 'Администратор']]
    : [['ivan@scrl.demo', 'Иван (ученик)'], ['masha@scrl.demo', 'Мария (ученик)'],
       ['teacher@scrl.demo', 'Учитель'], ['admin@scrl.demo', 'Администратор']];
  const quick = DEMO_MODE ? quickUsers.map(([email, label]) =>
    '<form method="POST" action="' + action + '"><input type="hidden" name="email" value="' + email +
    '"><input type="hidden" name="password" value="password123"><button class="btn btn-ghost btn-sm btn-block" style="margin:0">' +
    label + '</button></form>').join('') : '';
  const staffNote = staffOnly
    ? '<p class="muted small mt-2">Роль учителя выдаёт администратор. Входите по email и паролю своего аккаунта ScRl.</p>'
    : '<p class="text-center mt-2"><a href="/staff/login">Вход для учителей и сотрудников</a></p>';
  sendHtml(res, layout(title, null,
    '<div class="card" style="max-width:440px;margin:40px auto"><h1>' +
    (staffOnly ? 'Вход для учителей' : 'Вход в ScRl') + '</h1>' + flashBox(url) +
    '<form method="POST" action="' + action + '"><label>Email</label><input name="email" type="email" required autocomplete="username" placeholder="name@example.com">' +
    '<label>Пароль</label><input name="password" type="password" required autocomplete="current-password">' +
    '<button type="submit" class="btn btn-primary btn-block">Войти</button></form>' +
    staffNote +
    (staffOnly ? '<p class="text-center mt-2"><a href="/login">Вход для учеников</a></p>' :
      '<p class="text-center mt-2">Нет аккаунта? <a href="/register">Зарегистрироваться</a></p>') +
    (DEMO_MODE ? '<hr><p class="muted small">Демо-вход (только для тестовой среды):</p><div class="grid-2 mt-1">' + quick + '</div>' : '') +
    '</div>'));
}

function pageStaffLogin(res, user, url) {
  return pageLogin(res, user, url, true);
}

function doLogin(req, res, params, staffOnly = false) {
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const loginPath = staffOnly ? '/staff/login' : '/login';
  if (loginRateLimited(req, email)) return redirect(res, loginPath + '?error=wrong');
  const isDemoAccount = email.endsWith('@scrl.demo');
  const user = state.users.find(item => item.email === email);
  if (!user || (isDemoAccount && !DEMO_MODE) || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(req, email);
    return redirect(res, loginPath + '?error=wrong');
  }
  const ip = String(req.socket?.remoteAddress || 'unknown').slice(0, 80);
  loginFailures.delete(ip + '|' + email);
  if (user.deleted_at || user.role === 'deleted') return redirect(res, loginPath + '?error=deleted_acc');
  if (user.is_blocked) return redirect(res, loginPath + '?error=blocked_acc');
  if (staffOnly && !['teacher', 'admin'].includes(user.role)) {
    return redirect(res, loginPath + '?error=wrong_role');
  }

  if (!user.password_hash.startsWith('scrypt$')) {
    user.password_hash = hashPassword(password);
    save();
  }

  const token = crypto.randomUUID();
  sessions.set(token, sessionRecord(user.id));
  const location = user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/app';
  res.writeHead(302, {
    Location: location,
    'Set-Cookie': sessionCookie(req, token, SESSION_MAX_AGE),
    'Cache-Control': 'no-store'
  });
  res.end();
}

function doStaffLogin(req, res, params) {
  return doLogin(req, res, params, true);
}

function pageRegister(res, user, url) {
  if (user) return redirect(res, '/');
  sendHtml(res, layout('Регистрация', null,
    '<div class="card" style="max-width:440px;margin:40px auto"><h1>Регистрация ученика</h1>' + flashBox(url) +
    '<form method="POST" action="/register"><label>ФИО</label><input name="full_name" maxlength="80" required autocomplete="name">' +
    '<label>Email</label><input name="email" type="email" maxlength="254" required autocomplete="email">' +
    '<label>Пароль (не менее 8 символов)</label><input name="password" type="password" required minlength="8" maxlength="1024" autocomplete="new-password">' +
    '<label>Класс</label><input name="class_name" maxlength="20" required placeholder="8А">' +
    '<label>Дата рождения</label><input name="birth_date" type="date" required>' +
    '<button type="submit" class="btn btn-primary btn-block">Создать аккаунт</button></form>' +
    '<p class="text-center mt-2">Уже есть аккаунт? <a href="/login">Войти</a></p>' +
    '<p class="muted small mt-2">Стартовый бонус ScRl рассчитывается по текущему соотношению валют. До 14 лет торговля недоступна.</p></div>'));
}

function doRegister(req, res, params) {
  const fullName = (params.get('full_name') || '').trim().slice(0, 80);
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const className = (params.get('class_name') || '').trim().slice(0, 20);
  const birthDate = params.get('birth_date') || '';

  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      email.endsWith('@scrl.demo') || password.length < 8 || password.length > 1024 ||
      !className || ageStatus(birthDate) === 'unknown') {
    return redirect(res, '/register?error=fields');
  }
  if (state.users.some(item => item.email === email)) return redirect(res, '/register?error=email');

  const reserve = systemAccount('reserve');
  // Capture the economy-wide ratio before this user's starter V-RUB grant
  // changes the supply used to calculate their welcome ScRl amount.
  const signupRateAtRegistration = getTokenMarketStats().referenceRate;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const user = {
    id, email, password_hash: hashPassword(password), role: 'student',
    full_name: fullName, class_name: className, birth_date: birthDate,
    is_blocked: false, created_at: createdAt
  };
  state.users.push(user);
  const available = account(id, 'available');
  account(id, 'held');
  account(id, 'vrub_held');
  grantStartingVrub(id, 'registration');

  const signupBonusScRl = calculateSignupBonusScRl(signupRateAtRegistration);
  if (signupBonusScRl > 0 && reserve && reserve.balance >= signupBonusScRl) {
    try {
      recordTx('signup_bonus', id, { amount: signupBonusScRl, valueVrub: 5 }, [
        { accountId: reserve.id, amount: -signupBonusScRl },
        { accountId: available.id, amount: signupBonusScRl }
      ]);
    } catch (error) {
      if (error.code !== 'backing_limit') {
        state.users = state.users.filter(item => item.id !== id);
        state.accounts = state.accounts.filter(item => item.user_id !== id);
        state.vrub_ledger_entries = state.vrub_ledger_entries.filter(item => item.user_id !== id);
        try { save(); } catch (saveError) {
          console.error('Registration rollback save failed:', saveError.message);
        }
        console.error('Registration bonus failed:', error.message);
        return redirect(res, '/register?error=ledger');
      }
      // If capacity changed before commit, keep registration and omit ScRl.
      save();
    }
  } else {
    // V-RUB starter credit remains; whole ScRl units are not over-issued
    // when the fixed 5 V-RUB-equivalent allowance is below one token.
    save();
  }

  const token = crypto.randomUUID();
  sessions.set(token, sessionRecord(id));
  res.writeHead(302, {
    Location: '/app?msg=registered',
    'Set-Cookie': sessionCookie(req, token, SESSION_MAX_AGE),
    'Cache-Control': 'no-store'
  });
  res.end();
}


function doLogout(req, res) {
  const token = parseCookies(req).scrl_session;
  if (token) sessions.delete(token);
  res.writeHead(302, {
    Location: '/login',
    'Set-Cookie': 'scrl_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' +
      ((req.socket && req.socket.encrypted) ? '; Secure' : ''),
    'Cache-Control': 'no-store'
  });
  res.end();
}

module.exports = { pageLogin, doLogin, pageStaffLogin, doStaffLogin, pageRegister, doRegister, doLogout };
