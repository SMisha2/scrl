const crypto = require('node:crypto');
const { SESSION_MAX_AGE } = require('../config');
const { state, account, systemAccount, save, recordTx } = require('../store');
const { hashPassword } = require('../security');
const { sessions, parseCookies } = require('../session');
const { sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
function pageLogin(res, user, url) {
  if (user) return redirect(res, '/');
  const quick = [
    ['ivan@scrl.demo', 'Иван (ученик)'],
    ['masha@scrl.demo', 'Мария (ученик)'],
    ['teacher@scrl.demo', 'Учитель'],
    ['admin@scrl.demo', 'Админ']
  ].map(([e, l]) => `<form method="POST" action="/login"><input type="hidden" name="email" value="${e}"><input type="hidden" name="password" value="password123"><button class="btn btn-ghost btn-sm btn-block" style="margin:0">${l}</button></form>`).join('');
  sendHtml(res, layout('Вход', null, `
    <div class="card" style="max-width:440px;margin:40px auto">
      <h1>Вход в ScRl</h1>
      <p class="muted" style="margin-bottom:16px">Школьная экономика</p>
      ${flashBox(url)}
      <form method="POST" action="/login">
        <label>Email</label>
        <input name="email" type="email" required placeholder="ivan@scrl.demo">
        <label>Пароль</label>
        <input name="password" type="password" required placeholder="password123">
        <button type="submit" class="btn btn-primary btn-block">Войти</button>
      </form>
      <p class="text-center mt-2">Нет аккаунта? <a href="/register">Зарегистрироваться</a></p>
      <hr>
      <p class="muted small">Быстрый вход (пароль <code>password123</code>):</p>
      <div class="grid-2 mt-1">${quick}</div>
    </div>`));
}


function doLogin(req, res, params) {
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const user = state.users.find(u => u.email === email);
  if (!user || user.password_hash !== hashPassword(password)) return redirect(res, '/login?error=wrong');
  if (user.is_blocked) return redirect(res, '/login?error=blocked_acc');
  const token = crypto.randomUUID();
  sessions.set(token, user.id);
  const loc = user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/app';
  res.writeHead(302, {
    Location: loc,
    'Set-Cookie': `scrl_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}`
  });
  res.end();
}


function pageRegister(res, user, url) {
  if (user) return redirect(res, '/');
  sendHtml(res, layout('Регистрация', null, `
    <div class="card" style="max-width:440px;margin:40px auto">
      <h1>Регистрация ученика</h1>
      ${flashBox(url)}
      <form method="POST" action="/register">
        <label>ФИО</label><input name="full_name" required>
        <label>Email</label><input name="email" type="email" required>
        <label>Пароль (мин. 6)</label><input name="password" type="password" required minlength="6">
        <label>Класс</label><input name="class_name" required placeholder="8А">
        <label>Дата рождения</label><input name="birth_date" type="date" required>
        <button type="submit" class="btn btn-primary btn-block">Создать аккаунт</button>
      </form>
      <p class="text-center mt-2">Уже есть аккаунт? <a href="/login">Войти</a></p>
      <p class="muted small mt-2">При регистрации начисляется 100 ScRl. До 14 лет торговля недоступна.</p>
    </div>`));
}


function doRegister(req, res, params) {
  const full_name = (params.get('full_name') || '').trim();
  const email = (params.get('email') || '').trim().toLowerCase();
  const password = params.get('password') || '';
  const class_name = (params.get('class_name') || '').trim();
  const birth_date = params.get('birth_date') || '';
  if (!full_name || !email || !password || !class_name || !birth_date) return redirect(res, '/register?error=fields');
  if (state.users.find(u => u.email === email)) return redirect(res, '/register?error=email');

  const id = crypto.randomUUID();
  state.users.push({
    id, email, password_hash: hashPassword(password), role: 'student',
    full_name, class_name, birth_date, is_blocked: false,
    created_at: new Date().toISOString()
  });
  account(id, 'available');
  account(id, 'held');
  account(id, 'vrub').balance = 1000;
  save();

  recordTx('signup_bonus', id, { amount: 100 }, [
    { accountId: systemAccount('reserve').id, amount: -100 },
    { accountId: account(id, 'available').id, amount: 100 }
  ]);

  const token = crypto.randomUUID();
  sessions.set(token, id);
  res.writeHead(302, {
    Location: '/app?msg=registered',
    'Set-Cookie': `scrl_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}`
  });
  res.end();
}


function doLogout(req, res) {
  const token = parseCookies(req).scrl_session;
  if (token) sessions.delete(token);
  res.writeHead(302, { Location: '/login', 'Set-Cookie': 'scrl_session=; HttpOnly; Path=/; Max-Age=0' });
  res.end();
}


module.exports = { pageLogin, doLogin, pageRegister, doRegister, doLogout };
