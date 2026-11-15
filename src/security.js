const crypto = require('node:crypto');
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'scrl-salt-v1').digest('hex');
}


module.exports = { hashPassword };
