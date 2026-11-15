const PRICE_MODES = new Set(['fixed', 'range', 'negotiable', 'free', 'barter']);

function parseDeadline(value, offsetValue, nowMs = Date.now()) {
  if (!value) return { ok: true, value: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value));
  const offset = Number(offsetValue);
  if (!match || !Number.isInteger(offset) || Math.abs(offset) > 840) {
    return { ok: false, value: null, error: 'deadline' };
  }

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(localAsUtc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) {
    return { ok: false, value: null, error: 'deadline' };
  }

  // datetime-local is a wall-clock value from the visitor's browser.
  // getTimezoneOffset() is added to convert that local value to UTC.
  const utcMs = localAsUtc + offset * 60000;
  if (!Number.isFinite(utcMs) || utcMs < Number(nowMs) - 60000) {
    return { ok: false, value: null, error: 'deadline' };
  }
  return { ok: true, value: new Date(utcMs).toISOString() };
}

function resolvePostTerms(post, proposedPriceRaw) {
  const mode = PRICE_MODES.has(post && post.price_mode) ? post.price_mode : 'negotiable';
  if (mode === 'free') return { ok: true, proposalType: 'free', price: 0 };
  if (mode === 'barter') return { ok: true, proposalType: 'barter', price: 0 };

  if (mode === 'fixed') {
    const price = Number(post.price);
    if (!Number.isSafeInteger(price) || price < 1 || price > 1000000) {
      return { ok: false, error: 'price' };
    }
    return { ok: true, proposalType: 'paid', price };
  }

  const price = Number(proposedPriceRaw || 0);
  if (!Number.isSafeInteger(price) || price < 1 || price > 1000000) {
    return { ok: false, error: 'price' };
  }

  if (mode === 'range') {
    const minimum = Number(post.price_min);
    const maximum = Number(post.price_max);
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) ||
        minimum < 1 || maximum < minimum || price < minimum || price > maximum) {
      return { ok: false, error: 'price_range' };
    }
  }

  return { ok: true, proposalType: 'paid', price };
}

module.exports = { parseDeadline, resolvePostTerms };
