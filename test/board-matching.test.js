const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendHelpOffers } = require('../src/services/board-matching');

const user = { id: 'student-1' };
const users = [
  user,
  { id: 'student-2', full_name: 'Алексей', is_blocked: false },
  { id: 'student-3', full_name: 'Мария', is_blocked: false },
  { id: 'student-4', full_name: 'Скрытый', is_blocked: true }
];
const requests = [
  { id: 'd1', user_id: user.id, status: 'active', category: ' Математика ' }
];
const offers = [
  { id: 'o1', user_id: 'student-2', status: 'active', category: 'математика', price_mode: 'negotiable', created_at: '2026-11-15T10:00:00Z' },
  { id: 'o2', user_id: 'student-3', status: 'active', category: 'МАТЕМАТИКА', price_mode: 'free', created_at: '2026-11-14T10:00:00Z' },
  { id: 'o3', user_id: 'student-4', status: 'active', category: 'Математика', price_mode: 'free', created_at: '2026-11-15T11:00:00Z' },
  { id: 'o4', user_id: 'student-3', status: 'active', category: 'Английский', price_mode: 'free', created_at: '2026-11-15T11:00:00Z' }
];

test('matches exact categories case-insensitively and prioritizes free help', () => {
  const result = recommendHelpOffers({
    user, demandPosts: requests, offerPosts: offers, users,
    canTradeUser: () => true
  });
  assert.deepEqual(result.map(item => item.offer.id), ['o2', 'o1']);
  assert.equal(result[0].request.id, 'd1');
});

test('under-14 users are only shown free offers', () => {
  const result = recommendHelpOffers({
    user, demandPosts: requests, offerPosts: offers, users,
    canTradeUser: () => false
  });
  assert.deepEqual(result.map(item => item.offer.id), ['o2']);
});

test('does not recommend blocked users, own offers, inactive offers, or unrelated categories', () => {
  const result = recommendHelpOffers({
    user,
    demandPosts: requests,
    offerPosts: [
      ...offers,
      { id: 'o5', user_id: user.id, status: 'active', category: 'Математика', price_mode: 'free' },
      { id: 'o6', user_id: 'student-2', status: 'closed', category: 'Математика', price_mode: 'free' }
    ],
    users,
    canTradeUser: () => true
  });
  assert.deepEqual(result.map(item => item.offer.id), ['o2', 'o1']);
});

test('returns no suggestions when the student has no active help request', () => {
  assert.deepEqual(recommendHelpOffers({
    user, demandPosts: [], offerPosts: offers, users, canTradeUser: () => true
  }), []);
});
