const http = require('node:http');
const { PORT } = require('./config');
const { sessions, getSessionUser } = require('./session');
const { readBody, sendHtml, redirect, esc } = require('./utils/http');
const { layout } = require('./views/layout');
const { pageLogin, doLogin, pageRegister, doRegister, doLogout } = require('./features/auth');
const { pageApp, pageWallet } = require('./features/student');
const { pageMarket, handleCreateListing, handleDeleteListing, handleBuyListing, pageOrders, handleDeliver, handleConfirm } = require('./features/market');
const { pageAuctions, handleCreateAuction, handleBid, handleFinishAuction } = require('./features/auctions');
const { pageExchange, handleExchangeSell, handleExchangeCancel, handleExchangeBuy } = require('./features/exchange');
const { pageTeacher, handleIssue, pageAdmin, pageAdminUsers, handleCredit, handleDebit, handleBlock } = require('./features/staff');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = req.method;
    const user = getSessionUser(req);
    let params = new URLSearchParams();
    if (method === 'POST') {
      const body = await readBody(req);
      params = new URLSearchParams(body);
    }

    if (path === '/login' && method === 'GET') return pageLogin(res, user, url);
    if (path === '/login' && method === 'POST') return doLogin(req, res, params);
    if (path === '/register' && method === 'GET') return pageRegister(res, user, url);
    if (path === '/register' && method === 'POST') return doRegister(req, res, params);
    if (path === '/logout') return doLogout(req, res);

    if (path === '/') {
      if (!user) return redirect(res, '/login');
      return redirect(res, user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/app');
    }

    if (!user) return redirect(res, '/login');
    if (user.is_blocked) {
      for (const [k, v] of sessions) if (v === user.id) sessions.delete(k);
      return redirect(res, '/login?error=blocked_acc');
    }

    if (path === '/app' && method === 'GET') return pageApp(res, user, url);
    if (path === '/wallet' && method === 'GET') return pageWallet(res, user, url);
    if (path === '/market' && method === 'GET') return pageMarket(res, user, url);
    if (path === '/market/create' && method === 'POST') return handleCreateListing(res, user, params);
    if (path === '/market/delete' && method === 'POST') return handleDeleteListing(res, user, params);
    if (path === '/market/buy' && method === 'POST') return handleBuyListing(res, user, params);
    if (path === '/orders' && method === 'GET') return pageOrders(res, user, url);
    if (path === '/orders/deliver' && method === 'POST') return handleDeliver(res, user, params);
    if (path === '/orders/confirm' && method === 'POST') return handleConfirm(res, user, params);
    if (path === '/auctions' && method === 'GET') return pageAuctions(res, user, url);
    if (path === '/auctions/create' && method === 'POST') return handleCreateAuction(res, user, params);
    if (path === '/auctions/bid' && method === 'POST') return handleBid(res, user, params);
    if (path === '/auctions/finish' && method === 'POST') return handleFinishAuction(res, user, params);
    if (path === '/exchange' && method === 'GET') return pageExchange(res, user, url);
    if (path === '/exchange/sell' && method === 'POST') return handleExchangeSell(res, user, params);
    if (path === '/exchange/buy' && method === 'POST') return handleExchangeBuy(res, user, params);
    if (path === '/exchange/cancel' && method === 'POST') return handleExchangeCancel(res, user, params);
    if (path === '/teacher' && method === 'GET') return pageTeacher(res, user, url);
    if (path === '/teacher/issue' && method === 'POST') return handleIssue(res, user, params);
    if (path === '/admin' && method === 'GET') return pageAdmin(res, user, url);
    if (path === '/admin/users' && method === 'GET') return pageAdminUsers(res, user, url);
    if (path === '/admin/credit' && method === 'POST') return handleCredit(res, user, params);
    if (path === '/admin/debit' && method === 'POST') return handleDebit(res, user, params);
    if (path === '/admin/block' && method === 'POST') return handleBlock(res, user, params);

    sendHtml(res, layout('404', user, '<div class="card"><h1>404</h1><p>Страница не найдена</p><a href="/" class="btn btn-primary mt-2">На главную</a></div>'), 404);
  } catch (e) {
    console.error(e);
    sendHtml(res, `<h1>Ошибка</h1><pre>${esc(e.stack || e.message)}</pre><a href="/">На главную</a>`, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  ScRl → http://localhost:${PORT}\n`);
  console.log('  Демо-вход (пароль password123):');
  console.log('    ivan@scrl.demo     — ученик');
  console.log('    masha@scrl.demo    — ученик');
  console.log('    petya@scrl.demo    — ученик 12 лет (торговля заблокирована)');
  console.log('    teacher@scrl.demo  — учитель');
  console.log('    admin@scrl.demo    — администратор\n');
  console.log(`  Данные: ${DATA_FILE}\n`);
});

module.exports = server;
