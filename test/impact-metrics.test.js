const test = require('node:test');
const assert = require('node:assert/strict');
const { buildImpactMetrics } = require('../src/services/impact-metrics');

const now = Date.parse('2026-11-15T12:00:00.000Z');
const hour = 60 * 60 * 1000;
const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];

test('counts completed help and free help without treating token balance as impact', () => {
  const result = buildImpactMetrics({
    students,
    demands: [{ id: 'd1', user_id: 's1', category: 'Математика', status: 'completed', created_at: new Date(now - 2 * hour).toISOString() }],
    offers: [],
    applications: [],
    deals: [
      { buyer_id: 's1', seller_id: 's2', status: 'completed', deal_type: 'free', created_at: new Date(now - hour).toISOString(), completed_at: new Date(now - 1000).toISOString() },
      { buyer_id: 's1', seller_id: 's3', status: 'completed', deal_type: 'paid', created_at: new Date(now - hour).toISOString(), completed_at: new Date(now - 1000).toISOString() }
    ]
  }, now);

  assert.equal(result.completedDeals30d, 2);
  assert.equal(result.freeHelpDeals30d, 1);
  assert.equal(result.studentsReached30d, 3);
});

test('finds active requests without an unanswered pending response and category gaps', () => {
  const result = buildImpactMetrics({
    students,
    demands: [
      { id: 'd1', user_id: 's1', category: 'Математика', status: 'active', created_at: new Date(now - hour).toISOString() },
      { id: 'd2', user_id: 's2', category: 'Математика', status: 'active', created_at: new Date(now - hour).toISOString() },
      { id: 'd3', user_id: 's3', category: 'Английский', status: 'active', created_at: new Date(now - hour).toISOString() }
    ],
    offers: [
      { id: 'o1', user_id: 's2', category: 'Математика', status: 'active' }
    ],
    applications: [
      { id: 'a1', post_id: 'd1', owner_id: 's1', post_kind: 'demand', applicant_id: 's2', status: 'pending', created_at: new Date(now - 30 * 60 * 1000).toISOString() }
    ],
    deals: []
  }, now);

  assert.equal(result.activeRequests, 3);
  assert.equal(result.unansweredRequests, 2);
  assert.deepEqual(result.categoryGaps, [
    { category: 'Математика', requests: 2, offers: 1 },
    { category: 'Английский', requests: 1, offers: 0 }
  ]);
});

test('calculates first response speed and 24-hour response share for recent requests', () => {
  const result = buildImpactMetrics({
    students,
    demands: [
      { id: 'd1', user_id: 's1', category: 'Физика', status: 'active', created_at: new Date(now - 4 * hour).toISOString() },
      { id: 'd2', user_id: 's2', category: 'Физика', status: 'active', created_at: new Date(now - 2 * hour).toISOString() }
    ],
    offers: [],
    applications: [
      { id: 'a1', post_id: 'd1', owner_id: 's1', post_kind: 'demand', created_at: new Date(now - 3 * hour).toISOString() }
    ],
    deals: []
  }, now);

  assert.equal(result.requestsCreated30d, 2);
  assert.equal(result.respondedRequests30d, 1);
  assert.equal(result.responseRate30d, 0.5);
  assert.equal(result.averageFirstResponseHours, 1);
  assert.equal(result.responseWithin24hRate, 0.5);
});

test('excludes users and deals outside a teacher class scope', () => {
  const result = buildImpactMetrics({
    students: [{ id: 's1' }],
    demands: [{ id: 'd1', user_id: 's2', category: 'Химия', status: 'active', created_at: new Date(now - hour).toISOString() }],
    offers: [],
    applications: [],
    deals: [{ buyer_id: 's2', seller_id: 's3', status: 'completed', deal_type: 'free', created_at: new Date(now - hour).toISOString(), completed_at: now }]
  }, now);

  assert.equal(result.studentsCount, 1);
  assert.equal(result.activeRequests, 0);
  assert.equal(result.completedDeals30d, 0);
  assert.equal(result.studentsReached30d, 0);
});
