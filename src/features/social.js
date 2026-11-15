const crypto = require('node:crypto');
const { state, save } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { flashBox } = require('../views/feedback');
const { layout } = require('../views/layout');
const { notify } = require('../utils/notifications');

function handleReportPost(res, user, params) {
  if (user.role !== 'student') return redirect(res, '/');
  const postId = params.get('post_id');
  const kind = params.get('post_kind') === 'offer' ? 'offer' : 'demand';
  const collection = kind === 'offer' ? state.offer_posts : state.demand_posts;
  const post = collection.find(p => p.id === postId && p.status === 'active');
  if (!post || post.user_id === user.id) return redirect(res, '/?error=bad');
  const existing = state.reports.find(r => r.post_id === postId && r.created_by === user.id && r.status === 'open');
  if (existing) return redirect(res, '/?msg=reported');
  state.reports.unshift({
    id: crypto.randomUUID(), post_id: postId, post_kind: kind,
    created_by: user.id, reason: 'Жалоба пользователя на публикацию',
    status: 'open', created_at: new Date().toISOString()
  });
  state.admin_audit_logs.push({ id: crypto.randomUUID(), actor_id: user.id, action: 'post_reported', target_id: postId, reason: 'User report', created_at: new Date().toISOString() });
  state.users.filter(u => u.role === 'admin').forEach(a => notify(a.id, 'moderation', 'Новая жалоба', 'Поступила жалоба на публикацию «' + post.title + '».', '/admin/moderation'));
  save();
  return redirect(res, kind === 'offer' ? '/offers?msg=reported' : '/demand?msg=reported');
}

function pageFavorites(res, user, url) {
  if (user.role !== 'student') return redirect(res, '/');
  const favs = state.favorites.filter(f => f.user_id === user.id);
  const cards = favs.map(f => {
    const post = (f.post_kind === 'offer' ? state.offer_posts : state.demand_posts).find(p => p.id === f.post_id);
    if (!post || post.status !== 'active') return '';
    const author = state.users.find(u => u.id === post.user_id);
    return '<article class="card"><div class="row-between"><span class="badge badge-primary-soft">' + esc(f.post_kind === 'offer' ? 'Предложение' : 'Запрос') + '</span><form method="POST" action="/favorites/toggle"><input type="hidden" name="post_id" value="' + esc(post.id) + '"><input type="hidden" name="post_kind" value="' + esc(f.post_kind) + '"><button class="btn btn-ghost btn-sm">Убрать</button></form></div><h2 class="mt-1">' + esc(post.title) + '</h2><p>' + esc(post.description) + '</p><div class="row-between mt-1"><b>' + esc(post.price_mode === 'free' ? 'Бесплатно' : post.price_mode === 'barter' ? 'Обмен' : post.price_mode === 'negotiable' ? 'Договорная цена' : (post.price || post.price_min || 0) + ' ScRl') + '</b><span class="muted small">' + esc(author ? author.full_name : '') + '</span></div><a class="btn btn-primary btn-sm mt-1" href="' + (f.post_kind === 'offer' ? '/offers' : '/demand') + '">Открыть доску</a></article>';
  }).filter(Boolean).join('');
  sendHtml(res, layout('Избранное', user, flashBox(url) + '<h1>Избранное</h1>' + (cards || '<div class="card"><p class="muted">Вы пока ничего не добавили в избранное.</p></div>')));
}

module.exports = { handleReportPost, pageFavorites };
