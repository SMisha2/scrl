const crypto = require('node:crypto');
const { state, save } = require('../store');

function notify(userId, type, title, body, href) {
  if (!userId) return null;
  const item = {
    id: crypto.randomUUID(),
    user_id: userId,
    type: String(type || 'info'),
    title: String(title || 'Уведомление').slice(0, 120),
    body: String(body || '').slice(0, 500),
    href: href || '/',
    is_read: false,
    created_at: new Date().toISOString()
  };
  state.notifications.unshift(item);
  save();
  return item;
}

function unreadCount(userId) {
  return state.notifications.filter(n => n.user_id === userId && !n.is_read).length;
}

module.exports = { notify, unreadCount };
