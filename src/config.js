const path = require('node:path');
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, '..', 'scrl-data.json');
const SESSION_MAX_AGE = 7 * 24 * 3600;

const WEEKLY_LIMIT = 500;


module.exports = { PORT, DATA_FILE, SESSION_MAX_AGE, WEEKLY_LIMIT };
