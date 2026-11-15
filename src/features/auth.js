const crypto = require('node:crypto');
const { SESSION_MAX_AGE } = require('../config');
const { state, account, systemAccount, save, recordTx } = require('../store');
const { hashPassword, verifyPassword } = require('../security');
const { sessions, parseCookies, sessionRecord, ageStatus } = require('../session');
const { sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');

const DEMO_MODE = process.env.SCRL_DEMO_MODE === 'true';

function sessionCookie(req, token, maxAge) {
  const secure = Boolean(req.socket && req.socket.encrypted) ||
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return 'scrl_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

function pageLogin(res, user, url) {
  if (user) return redirect(res, '/');
  const quick = DEMO_MODE ? [
    ['ivan@scrl.demo', 'Иван (ученик)'],
    ['masha@scrl.demo', 'Мария (ученик)'],
    ['teacher@scrl.demo', 'Учитель'],
    ['admin@scrl.demo', 'Админ']
  ].map(([email, label]) => '<form method="POST" action="/login"><input type="hidden" name="email" value="' + email + '"><input type="hidden" name="password" value="password123"><button class="btn btn-ghost btn-sm btn-block" style="margin:0">' + label + '</button></form>').join('') : '';

  sendHtml(res, layout('Вход', null,
    '<div class="card" style="max-width:440px;margin:40px auto"><h1>Вход в ScRl</h1>' +
    '<p class="muted" style="margin-bottom:16px">Школьная экономика</p>' + flashBox(url) +
    '<form method="POST" action="/login"><label>Email</label><input name="email" type="email" required autocomplete="username" placeholder="name@example.com">' +
    '<label>Пароль</label><input name="password" type="password" required autocomplete="current-password">' +
    '<button type="submit" class="btn btn-primary btn-block">Войти</button></form>' +
    '<p class="text-center mt-2">Нет аккаунта? <a href="/register">Зарегистрироваться</a></p>' +
    (DEMO_MODE ? '<hr><p class="muted small">Демо-вход (только для тестовой среды, пароль password123):</p><div class="grid-2 mt-1">' + quick + '</div>' : '') +
    '</div>'));
}

function doLogin(req, res, params) {
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const isDemoAccount = email.endsWith('@scrl.demo');
  const user = state.users.find(item => item.email === email);
  if (!user || (isDemoAccount && !DEMO_MODE) || !verifyPassword(password, user.password_hash)) {
    return redirect(res, '/login?error=wrong');
  }
  if (user.is_blocked) return redirect(res, '/login?error=blocked_acc');

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
    '<p class="muted small mt-2">При регистрации начисляется 100 ScRl. До 14 лет торговля недоступна.</p></div>'));
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

  const id = crypto.randomUUID();
  state.users.push({
    id, email, password_hash: hashPassword(password), role: 'student',
    full_name: fullName, class_name: className, birth_date: birthDate,
    is_blocked: false, created_at: new Date().toISOString()
  });
  account(id, 'available');
  account(id, 'held');
  account(id, 'vrub').balance = 1000;
  save();

  const reserve = systemAccount('reserve');
  if (!reserve) throw new Error('Reserve account is not configured');
  recordTx('signup_bonus', id, { amount: 100 }, [
    { accountId: reserve.id, amount: -100 },
    { accountId: account(id, 'available').id, amount: 100 }
  ]);

  const token = crypto.randomUUID();
  sessions.set(token, sessionRecord(id));
  res.writeHead(302, {
    Location: '/app?msg=registered',
    'Set-Cookie': sessionCookie(req, token, 7 * 24 * 3600),
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

module.exports = { pageLogin, doLogin, pageRegister, doRegister, doLogout };
