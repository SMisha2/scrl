const crypto = require('node:crypto');
const { state, account, balance, recordTx, save, systemAccount } = require('../store');
const { canTrade } = require('../session');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
function auctionEscrowBalance(auctionId, userId) {
  const held = state.accounts.find(item => item.user_id === userId && item.kind === 'held');
  if (!held) return 0;
  const txIds = new Set(state.transactions
    .filter(tx => tx.payload && tx.payload.auctionId === auctionId)
    .map(tx => tx.id));
  return state.entries
    .filter(entry => txIds.has(entry.tx_id) && entry.account_id === held.id)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function autoFinishAuctions() {
  let changed = false;
  for (const auction of state.auctions) {
    if (auction.status !== 'active') continue;
    const endTime = new Date(auction.ends_at).getTime();
    if (!Number.isFinite(endTime)) {
      auction.status = 'settlement_error';
      auction.settlement_error = 'Некорректная дата завершения аукциона.';
      auction.settlement_error_at = new Date().toISOString();
      changed = true;
      continue;
    }
    if (endTime >= Date.now()) continue;

    if (auction.current_winner_id && Number(auction.current_bid) > 0) {
      const existing = state.transactions.find(tx => tx.kind === 'auction_burn' && tx.payload && tx.payload.auctionId === auction.id);
      const winningBid = state.bids.find(bid => bid.auction_id === auction.id &&
        bid.bidder_id === auction.current_winner_id && bid.amount === auction.current_bid && bid.status === 'active');
      const held = state.accounts.find(item => item.user_id === auction.current_winner_id && item.kind === 'held');
      const burn = systemAccount('burn');

      if (!existing && (!winningBid || !held || auctionEscrowBalance(auction.id, auction.current_winner_id) !== Number(auction.current_bid) || held.balance < auction.current_bid || !burn)) {
        auction.status = 'settlement_error';
        auction.settlement_error = 'Не удалось подтвердить удержанную победную ставку.';
        auction.settlement_error_at = new Date().toISOString();
        changed = true;
        continue;
      }
      try {
        if (!existing) {
          recordTx('auction_burn', auction.current_winner_id, { auctionId: auction.id, amount: auction.current_bid }, [
            { accountId: held.id, amount: -auction.current_bid, note: 'Победная ставка' },
            { accountId: burn.id, amount: auction.current_bid, note: 'Аукцион ScRl' }
          ]);
        }
        if (winningBid) winningBid.status = 'won';
      } catch (error) {
        auction.status = 'settlement_error';
        auction.settlement_error = 'Сбой списания ставки: ' + String(error.message || 'unknown').slice(0, 160);
        auction.settlement_error_at = new Date().toISOString();
        changed = true;
        continue;
      }
    } else if (auction.current_winner_id || Number(auction.current_bid) > 0) {
      auction.status = 'settlement_error';
      auction.settlement_error = 'Некорректные данные победителя или ставки.';
      auction.settlement_error_at = new Date().toISOString();
      changed = true;
      continue;
    }

    auction.status = 'finished';
    auction.finished_at = new Date().toISOString();
    delete auction.settlement_error;
    changed = true;
  }
  if (changed) save();
}




function pageAuctions(res, user, url) {
  autoFinishAuctions();
  const canCreate = user.role === 'teacher' || user.role === 'admin';
  const tradeable = canTrade(user);
  const items = state.auctions.filter(a => a.status === 'active' || (a.status === 'settlement_error' && (user.role === 'admin' || user.role === 'teacher')))
    .sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at))
    .map(a => {
      const leader = state.users.find(u => u.id === a.current_winner_id);
      const minNext = a.current_bid > 0 ? a.current_bid + a.min_step : a.start_price;
      const ended = new Date(a.ends_at).getTime() < Date.now();
      const canBid = tradeable && !ended;
      const canFinish = (user.role === 'admin' || user.role === 'teacher') && !ended;
      return `<div class="card">
        <div class="row-between">
          <div><h3>${esc(a.title)}</h3><div class="muted small">Приз: ${esc(a.prize)}</div>
            <div class="small mt-1">Лидер: <b>${esc(leader ? leader.full_name : 'Нет лидера')}</b> · ставка ${a.current_bid} · шаг ${a.min_step}</div></div>
          <div style="text-align:right"><div class="muted small">до конца</div><div>${new Date(a.ends_at).toLocaleString('ru-RU')}</div></div>
        </div>
        ${canBid ? `<form method="POST" action="/auctions/bid" class="row mt-2"><input type="hidden" name="auction_id" value="${a.id}"><input name="amount" type="number" min="${minNext}" required placeholder="мин. ${minNext}" style="flex:1;max-width:160px;margin:0"><button class="btn btn-accent btn-sm">Сделать ставку</button></form>` : ''}
        ${canFinish ? `<form method="POST" action="/auctions/finish" class="mt-2"><input type="hidden" name="auction_id" value="${a.id}"><button class="btn btn-ghost btn-sm">${a.status === 'settlement_error' ? 'Повторить завершение' : 'Завершить сейчас'}</button></form>` : ''}
      </div>`;
    }).join('');
  const finished = state.auctions.filter(x => x.status === 'finished')
    .sort((x, y) => y.ends_at.localeCompare(x.ends_at)).slice(0, 10)
    .map(x => {
      const winner = state.users.find(u => u.id === x.current_winner_id);
      const history = state.bids.filter(b => b.auction_id === x.id)
        .sort((m, n) => n.created_at.localeCompare(m.created_at)).slice(0, 5)
        .map(b => {
          const bidder = state.users.find(u => u.id === b.bidder_id);
          return '<li class="small">' + esc(bidder ? bidder.full_name : 'Участник') + ': ' + b.amount + ' ScRl (' + esc(b.status) + ')</li>';
        }).join('');
      return '<div class="card"><div class="row-between"><b>' + esc(x.title) + '</b><span class="badge badge-muted">Завершён</span></div>' +
        '<p class="muted small">Приз: ' + esc(x.prize) + ' · Победитель: ' + esc(winner ? winner.full_name : 'Нет ставок') + ' · ' + x.current_bid + ' ScRl</p>' +
        '<details class="mt-1"><summary>История последних ставок</summary><ul>' + (history || '<li class="small">Ставок нет</li>') + '</ul></details></div>';
    }).join('');
  const createForm = canCreate ? `<div class="card"><h2>Создать аукцион</h2>
    <form method="POST" action="/auctions/create">
      <div class="grid grid-2">
        <div><label>Название</label><input name="title" required></div>
        <div><label>Неденежный приз</label><input name="prize" required maxlength="100" placeholder="Например, приз от лицея"></div>
      </div>
      <div class="grid grid-2">
        <div><label>Стартовая цена</label><input name="start_price" type="number" min="1" required></div>
        <div><label>Шаг</label><input name="min_step" type="number" min="1" value="10"></div>
      </div>
      <label>Длительность (минуты)</label><input name="duration_min" type="number" min="1" value="5">
      <button class="btn btn-primary">Создать</button>
    </form></div>` : '';
  sendHtml(res, layout('Аукционы', user, `
    ${flashBox(url)}
    <div class="row-between"><h1>Аукционы ScRl</h1><span class="badge badge-accent">Ставки в ScRl</span></div>
    ${createForm}
    <h2 class="mt-2">Активные</h2>
    ${items || '<p class="muted">Активных аукционов нет</p>'}
    <h2 class="mt-2">Завершённые</h2>
    ${finished || '<p class="muted">Завершённых аукционов пока нет.</p>'}`));
}


function handleCreateAuction(res, user, params) {
  if (user.role !== 'teacher' && user.role !== 'admin') return redirect(res, '/auctions?error=bad');
  const title = (params.get('title') || '').trim().slice(0, 100);
  const prize = (params.get('prize') || '').trim().slice(0, 100);
  const start = Number(params.get('start_price') || 0);
  const step = Number(params.get('min_step') || 10);
  const minutes = Number(params.get('duration_min') || 5);
  const hasMoneyPrize = /(руб|рубл|деньг|денеж|налич|перевод|оплат|usd|eur|cash|dollar|банковск|[₽€$])/iu.test(prize);
  if (!title || !prize || hasMoneyPrize ||
      !Number.isSafeInteger(start) || start < 1 || start > 1000000 ||
      !Number.isSafeInteger(step) || step < 1 || step > 1000000 ||
      !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10080) {
    return redirect(res, '/auctions?error=fields');
  }
  const now = new Date().toISOString();
  state.auctions.push({
    id: crypto.randomUUID(), title, prize, start_price: start, min_step: step,
    current_bid: 0, current_winner_id: null,
    ends_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    status: 'active', created_by: user.id, created_at: now
  });
  save();
  return redirect(res, '/auctions?msg=auction_created');
}




function handleBid(res, user, params) {
  if (user.role !== 'student' || !canTrade(user)) return redirect(res, '/auctions?error=age');
  const auctionId = params.get('auction_id');
  const amount = Number(params.get('amount') || 0);
  const auction = state.auctions.find(item => item.id === auctionId && item.status === 'active');
  if (!auction) return redirect(res, '/auctions?error=notfound');

  const endTime = new Date(auction.ends_at).getTime();
  if (!Number.isFinite(endTime)) return redirect(res, '/auctions?error=invalid_auction');
  if (endTime < Date.now()) return redirect(res, '/auctions?error=ended');
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) return redirect(res, '/auctions?error=amount');

  const currentBid = Number(auction.current_bid || 0);
  const minNext = currentBid > 0 ? currentBid + Number(auction.min_step || 0) : Number(auction.start_price || 0);
  if (!Number.isSafeInteger(minNext) || minNext < 1 || amount < minNext) return redirect(res, '/auctions?error=low');

  const sameLeader = Boolean(auction.current_winner_id && auction.current_winner_id === user.id);
  const spendable = balance(user.id, 'available') + (sameLeader ? currentBid : 0);
  if (spendable < amount) return redirect(res, '/auctions?error=insufficient');

  const original = {
    current_bid: auction.current_bid,
    current_winner_id: auction.current_winner_id,
    last_bid_at: auction.last_bid_at
  };
  let previousBid = null;
  let previousHeld = null;

  if (auction.current_winner_id || currentBid > 0) {
    if (!auction.current_winner_id || !Number.isSafeInteger(currentBid) || currentBid < 1) {
      return redirect(res, '/auctions?error=escrow');
    }
    previousBid = state.bids.find(bid => bid.auction_id === auctionId &&
      bid.bidder_id === auction.current_winner_id && bid.amount === currentBid && bid.status === 'active');
    previousHeld = state.accounts.find(item => item.user_id === auction.current_winner_id && item.kind === 'held');
    if (!previousBid || !previousHeld ||
        auctionEscrowBalance(auctionId, auction.current_winner_id) !== currentBid ||
        previousHeld.balance < currentBid) {
      return redirect(res, '/auctions?error=escrow');
    }

    const previousStatus = previousBid.status;
    previousBid.status = sameLeader ? 'raised' : 'outbid';
    auction.current_winner_id = null;
    auction.current_bid = 0;
    auction.last_bid_at = null;
    try {
      recordTx('auction_refund', auction.current_winner_id || previousBid.bidder_id,
        { auctionId, bidId: previousBid.id, amount: currentBid }, [
          { accountId: previousHeld.id, amount: -currentBid, note: 'Возврат прежней ставки' },
          { accountId: account(previousBid.bidder_id, 'available').id, amount: currentBid, note: 'Возврат прежней ставки' }
        ]);
    } catch (error) {
      previousBid.status = previousStatus;
      auction.current_bid = original.current_bid;
      auction.current_winner_id = original.current_winner_id;
      auction.last_bid_at = original.last_bid_at;
      save();
      console.error('Auction outbid refund failed:', error.message);
      return redirect(res, '/auctions?error=refund');
    }
  }

  const bid = {
    id: crypto.randomUUID(), auction_id: auctionId, bidder_id: user.id,
    amount, status: 'active', created_at: new Date().toISOString()
  };
  state.bids.push(bid);
  auction.current_bid = amount;
  auction.current_winner_id = user.id;
  auction.last_bid_at = bid.created_at;

  try {
    recordTx('auction_hold', user.id, { auctionId, amount, bidId: bid.id }, [
      { accountId: account(user.id, 'available').id, amount: -amount, note: 'Ставка' },
      { accountId: account(user.id, 'held').id, amount, note: 'Резерв ставки' }
    ]);
  } catch (error) {
    state.bids = state.bids.filter(item => item.id !== bid.id);
    auction.current_bid = 0;
    auction.current_winner_id = null;
    auction.last_bid_at = null;
    save();
    console.error('Auction bid hold failed:', error.message);
    return redirect(res, '/auctions?error=hold');
  }
  return redirect(res, '/auctions?msg=bid');
}


function handleFinishAuction(res, user, params) {
  if (user.role !== 'admin' && user.role !== 'teacher') return redirect(res, '/auctions?error=bad');
  const auctionId = params.get('auction_id');
  const auction = state.auctions.find(item => item.id === auctionId && ['active', 'settlement_error'].includes(item.status));
  if (!auction) return redirect(res, '/auctions?error=notfound');
  if (user.role === 'teacher' && auction.created_by !== user.id) return redirect(res, '/auctions?error=bad');

  if (auction.current_winner_id && Number(auction.current_bid) > 0) {
    const previous = state.transactions.find(tx => tx.kind === 'auction_burn' && tx.payload && tx.payload.auctionId === auction.id);
    const winningBid = state.bids.find(bid => bid.auction_id === auction.id &&
      bid.bidder_id === auction.current_winner_id && bid.amount === auction.current_bid && bid.status === 'active');
    const held = state.accounts.find(item => item.user_id === auction.current_winner_id && item.kind === 'held');
    const burn = systemAccount('burn');

    if (!previous && (!winningBid || !held || auctionEscrowBalance(auction.id, auction.current_winner_id) !== Number(auction.current_bid) || held.balance < auction.current_bid || !burn)) {
      auction.status = 'settlement_error';
      auction.settlement_error = 'Не удалось подтвердить победную ставку и её резерв.';
      auction.settlement_error_at = new Date().toISOString();
      save();
      return redirect(res, '/auctions?error=settlement');
    }
    try {
      if (!previous) {
        recordTx('auction_burn', auction.current_winner_id, { auctionId: auction.id, amount: auction.current_bid }, [
          { accountId: held.id, amount: -auction.current_bid, note: 'Победная ставка' },
          { accountId: burn.id, amount: auction.current_bid, note: 'Аукцион ScRl' }
        ]);
      }
      if (winningBid) winningBid.status = 'won';
    } catch (error) {
      auction.status = 'settlement_error';
      auction.settlement_error = String(error.message || 'Ошибка расчёта').slice(0, 160);
      auction.settlement_error_at = new Date().toISOString();
      save();
      console.error('auction finish:', error.message);
      return redirect(res, '/auctions?error=settlement');
    }
  } else if (auction.current_winner_id || Number(auction.current_bid) > 0) {
    auction.status = 'settlement_error';
    auction.settlement_error = 'Некорректные данные победителя или ставки.';
    auction.settlement_error_at = new Date().toISOString();
    save();
    return redirect(res, '/auctions?error=settlement');
  }

  auction.status = 'finished';
  auction.finished_at = new Date().toISOString();
  delete auction.settlement_error;
  save();
  return redirect(res, '/auctions?msg=auction_finished');
}


module.exports = { autoFinishAuctions, pageAuctions, handleCreateAuction, handleBid, handleFinishAuction };
