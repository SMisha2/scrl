const { SESSION_MAX_AGE } = require('./config');
const { state } = require('./store');
const sessions = new Map();

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const raw = pair.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(raw); }
    catch { out[key] = raw; }
  }
  return out;
}

function sessionRecord(userId) {
  return { userId, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 };
}

function getSessionUser(req) {
  const token = parseCookies(req).scrl_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  const userId = typeof session === 'string' ? session : session.userId;
  const expiresAt = typeof session === 'string' ? 0 : session.expiresAt;
  if (!userId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = state.users.find(item => item.id === userId) || null;
  if (!user) sessions.delete(token);
  return user;
}

function ageStatus(birth) {
  if (typeof birth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return 'unknown';
  const date = new Date(birth + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birth) return 'unknown';
  const today = new Date();
  if (date.getTime() > Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) return 'unknown';
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < date.getUTCDate())) age--;
  if (age < 0 || age > 110) return 'unknown';
  return age < 14 ? 'minor' : age < 18 ? 'teen' : 'adult';
}

function canTrade(user) {
  if (!user || user.role !== 'student') return false;
  const status = ageStatus(user.birth_date);
  return status === 'teen' || status === 'adult';
}

module.exports = { sessions, parseCookies, getSessionUser, ageStatus, canTrade, sessionRecord };
