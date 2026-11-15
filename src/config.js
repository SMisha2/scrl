const path = require('node:path');
const PORT = process.env.PORT || 3000;

const LEGACY_DATA_FILE = path.join(__dirname, '..', 'scrl-data.json');
const DATA_DIR = path.resolve(process.env.SCRL_DATA_DIR || path.dirname(LEGACY_DATA_FILE));
const DATA_FILE = path.join(DATA_DIR, 'scrl-data.json');
const SESSION_MAX_AGE = 7 * 24 * 3600;

const WEEKLY_LIMIT = 500;


module.exports = { PORT, DATA_DIR, DATA_FILE, LEGACY_DATA_FILE, SESSION_MAX_AGE, WEEKLY_LIMIT };
