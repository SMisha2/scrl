const http = require('node:http');
const { PORT, DATA_FILE } = require('./config');
const { sessions, getSessionUser } = require('./session');
const { readBody, sendHtml, redirect, esc } = require('./utils/http');
const { layout } = require('./views/layout');
const { pageLogin, doLogin, pageRegister, doRegister, doLogout } = require('./features/auth');
const { pageApp, pageWallet } = require('./features/student');
const { pageMarket, handleCreateListing, handleDeleteListing, handleBuyListing, pageOrders, handleDeliver, handleConfirm } = require('./features/market');
const { pageAuctions, handleCreateAuction, handleBid, handleFinishAuction } = require('./features/auctions');
const { pageExchange, handleExchangeSell, handleExchangeCancel, handleExchangeBuy } = require('./features/exchange');
const { pageTeacher, handleIssue, pageAdmin, pageAdminUsers, handleCredit, handleDebit, handleBlock } = require('./features/staff');
const community = require('./features/community');
const assistant = require('./features/assistant');
const finance = require('./features/finance');

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

    // Demand Board, Offer Board and community flows.
    if (path === '/marketplace' && method === 'GET') return redirect(res, '/demand');
    if (path === '/demand' && method === 'GET') return community.pageDemand(res, user, url);
    if ((path === '/offers' || path === '/offer') && method === 'GET') return community.pageOffers(res, user, url);
    if (path === '/demand/create' && method === 'POST') return community.handleCreateDemand(res, user, params);
    if ((path === '/offers/create' || path === '/offer/create') && method === 'POST') return community.handleCreateOffer(res, user, params);
    if (path === '/posts/respond' && method === 'POST') return community.handleRespond(res, user, params);
    if (path === '/posts/report' && method === 'POST') return community.handlePostReport(res, user, params);
    if (path === '/posts/close' && method === 'POST') return community.handleClosePost(res, user, params);
    if (path === '/applications' && method === 'GET') return community.pageApplications(res, user, url);
    if (path === '/applications/action' && method === 'POST') return community.handleApplicationAction(res, user, params);
    if (path === '/deals' && method === 'GET') return community.pageDeals(res, user, url);
    if (path === '/deal' && method === 'GET') return community.pageDeal(res, user, url);
    if (path === '/deals/message' && method === 'POST') return community.handleDealMessage(res, user, params);
    if (path === '/deals/deliver' && method === 'POST') return community.handleDealDeliver(res, user, params);
    if (path === '/deals/confirm' && method === 'POST') return community.handleDealConfirm(res, user, params);
    if (path === '/deals/dispute' && method === 'POST') return community.handleDealDispute(res, user, params);
    if (path === '/deals/review' && method === 'POST') return community.handleDealReview(res, user, params);
    if (path === '/favorites' && method === 'GET') return community.pageFavorites(res, user);
    if (path === '/favorites/toggle' && method === 'POST') return community.toggleFavorite(res, user, params);
    if (path === '/notifications' && method === 'GET') return community.pageNotifications(res, user, url);
    if (path === '/notifications/read' && method === 'POST') return community.markNotificationsRead(res, user);
    if (path === '/profile' && method === 'GET') return community.pageProfile(res, user, url);

    // RUB: sandbox test records only; no real-money movement is enabled.
    if (path === '/wallet/rub' && method === 'GET') return finance.pageRubWallet(res, user, url);
    if (path === '/wallet/rub/topup' && method === 'POST') return finance.handleSandboxTopUp(res, user, params);
    if (path === '/wallet/rub/payout' && method === 'POST') return finance.handleSandboxPayout(res, user, params);

    // Human-controlled moderation and local admin assistant.
    if (path === '/admin/ai' && method === 'GET') return assistant.pageAssistant(res, user);
    if (path === '/admin/ai/chat' && method === 'POST') return assistant.handleAssistantChat(res, user, params);
    if (path === '/admin/moderation' && method === 'GET') return assistant.pageModeration(res, user);
    if (path === '/admin/moderation/action' && method === 'POST') return assistant.handleModerationAction(res, user, params);
    if ((path === '/admin/financial' || path === '/admin/finance') && method === 'GET') return finance.pageFinancialOps(res, user, url);

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
