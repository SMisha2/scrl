const crypto = require('node:crypto');

const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 });
const LEGACY_SALT = 'scrl-salt-v1';

function hashPassword(password) {
  const value = String(password);
  if (value.length < 8 || value.length > 1024) throw new Error('Password length must be between 8 and 1024 characters');
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, SCRYPT.keyLength, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPassword(password, stored) {
  const value = String(password);
  if (typeof stored !== 'string' || value.length > 1024) return false;
  if (stored.startsWith('scrypt$')) {
    const [tag, nText, rText, pText, saltText, hashText] = stored.split('$');
    if (tag !== 'scrypt' || Number(nText) !== SCRYPT.N || Number(rText) !== SCRYPT.r ||
        Number(pText) !== SCRYPT.p || !saltText || !hashText) return false;
    try {
      const salt = Buffer.from(saltText, 'base64url');
      const expected = Buffer.from(hashText, 'base64url');
      if (salt.length !== 16 || expected.length !== SCRYPT.keyLength) return false;
      const actual = crypto.scryptSync(value, salt, SCRYPT.keyLength, SCRYPT);
      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  // Legacy SHA-256 hashes are upgraded after a successful login.
  const legacy = crypto.createHash('sha256').update(value + LEGACY_SALT).digest('hex');
  return safeEqual(legacy, stored);
}

module.exports = { hashPassword, verifyPassword };
