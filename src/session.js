const { state } = require('./store');
const sessions = new Map();


function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return out;
}

function getSessionUser(req) {
  const token = parseCookies(req).scrl_session;
  if (!token) return null;
  const uid = sessions.get(token);
  if (!uid) return null;
  return state.users.find(u => u.id === uid) || null;
}

function ageStatus(birth) {
  if (!birth) return 'unknown';
  const age = (Date.now() - new Date(birth).getTime()) / (365.25 * 24 * 3600 * 1000);
  return age < 14 ? 'minor' : age < 18 ? 'teen' : 'adult';
}

function canTrade(user) {
  if (!user || user.role !== 'student') return false;
  return ageStatus(user.birth_date) !== 'minor';
}


module.exports = { sessions, parseCookies, getSessionUser, ageStatus, canTrade };
