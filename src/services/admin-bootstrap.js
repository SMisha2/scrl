const crypto = require('node:crypto');
const { state, save } = require('../store');
const { hashPassword, verifyPassword } = require('../security');

function bootstrapAdmin() {
  const email = String(process.env.SCRL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SCRL_ADMIN_PASSWORD || '');
  if (!email && !password) return false;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 1024) {
    console.error('Set a valid SCRL_ADMIN_EMAIL and SCRL_ADMIN_PASSWORD with at least 12 characters.');
    return false;
  }

  let user = state.users.find(item => item.email === email);
  if (user && user.role !== 'admin') {
    console.error('SCRL_ADMIN_EMAIL is already assigned to a non-admin account. Use a separate admin email.');
    return false;
  }

  let changed = false;
  if (!user) {
    user = {
      id: crypto.randomUUID(), email, password_hash: hashPassword(password),
      role: 'admin', full_name: 'Администратор ScRl',
      class_name: null, birth_date: null, is_blocked: false,
      created_at: new Date().toISOString()
    };
    state.users.push(user);
    changed = true;
  } else if (!verifyPassword(password, user.password_hash)) {
    user.password_hash = hashPassword(password);
    changed = true;
  }

  if (changed) save();
  return true;
}

module.exports = { bootstrapAdmin };
