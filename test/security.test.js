const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('../src/security');

test('new password hashes use salted scrypt and verify correctly', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$32768\$8\$1\$/);
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('incorrect password', hash), false);
});

test('legacy SHA-256 hashes remain verifiable for gradual migration', () => {
  const legacy = crypto.createHash('sha256').update('password123scrl-salt-v1').digest('hex');
  assert.equal(verifyPassword('password123', legacy), true);
  assert.equal(verifyPassword('wrong', legacy), false);
});

test('new hashes reject too-short passwords', () => {
  assert.throws(() => hashPassword('short'), /8 and 1024/);
});
