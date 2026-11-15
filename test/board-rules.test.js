const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeadline, resolvePostTerms } = require('../src/services/board-rules');

test('converts browser local date-time to UTC using the submitted timezone offset', () => {
  const result = parseDeadline('2026-11-16T12:30', -60, Date.parse('2026-11-15T00:00:00Z'));
  assert.equal(result.ok, true);
  assert.equal(result.value, '2026-11-16T11:30:00.000Z');
});

test('allows an empty optional deadline', () => {
  assert.deepEqual(parseDeadline('', 0, Date.parse('2026-11-15T00:00:00Z')), {
    ok: true,
    value: null
  });
});

test('rejects impossible calendar dates and invalid timezone offsets', () => {
  assert.equal(parseDeadline('2026-02-30T12:30', 0, Date.parse('2026-01-01T00:00:00Z')).ok, false);
  assert.equal(parseDeadline('2026-11-16T12:30', 900, Date.parse('2026-11-15T00:00:00Z')).ok, false);
});

test('rejects deadlines that are already in the past', () => {
  assert.equal(parseDeadline('2026-11-14T12:30', 0, Date.parse('2026-11-15T00:00:00Z')).ok, false);
});

test('fixed-price posts keep the publisher price regardless of submitted price', () => {
  assert.deepEqual(resolvePostTerms({ price_mode: 'fixed', price: 50 }, '999'), {
    ok: true,
    proposalType: 'paid',
    price: 50
  });
});

test('free and barter posts cannot be converted into paid deals by a response', () => {
  assert.deepEqual(resolvePostTerms({ price_mode: 'free', price: 0 }, '500'), {
    ok: true,
    proposalType: 'free',
    price: 0
  });
  assert.deepEqual(resolvePostTerms({ price_mode: 'barter', price: 0 }, '500'), {
    ok: true,
    proposalType: 'barter',
    price: 0
  });
});

test('range posts accept only a whole-number price inside the published range', () => {
  const post = { price_mode: 'range', price_min: 20, price_max: 80 };
  assert.deepEqual(resolvePostTerms(post, '45'), { ok: true, proposalType: 'paid', price: 45 });
  assert.equal(resolvePostTerms(post, '10').error, 'price_range');
  assert.equal(resolvePostTerms(post, '90').error, 'price_range');
  assert.equal(resolvePostTerms(post, '').error, 'price');
});

test('negotiable posts require a valid proposed price', () => {
  assert.deepEqual(resolvePostTerms({ price_mode: 'negotiable' }, '35'), {
    ok: true,
    proposalType: 'paid',
    price: 35
  });
  assert.equal(resolvePostTerms({ price_mode: 'negotiable' }, '0').error, 'price');
  assert.equal(resolvePostTerms({ price_mode: 'negotiable' }, '1.5').error, 'price');
});
