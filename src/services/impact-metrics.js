const DAY_MS = 24 * 60 * 60 * 1000;

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function buildImpactMetrics(data, nowValue = Date.now()) {
  const now = Number(nowValue);
  const since = now - 30 * DAY_MS;
  const students = Array.isArray(data.students) ? data.students : [];
  const memberIds = new Set(students.map(student => student.id));
  const inScope = userId => memberIds.has(userId);

  const demands = (data.demands || []).filter(post => inScope(post.user_id));
  const offers = (data.offers || []).filter(post => inScope(post.user_id));
  const applications = data.applications || [];
  const deals = data.deals || [];

  const demandApplications = applications.filter(app =>
    app.post_kind === 'demand' && inScope(app.owner_id)
  );
  const applicationsByPost = new Map();
  for (const app of demandApplications) {
    const current = applicationsByPost.get(app.post_id) || [];
    current.push(app);
    applicationsByPost.set(app.post_id, current);
  }

  const recentDemands = demands.filter(post => {
    const created = timestamp(post.created_at);
    return created !== null && created >= since && created <= now;
  });
  let respondedRequests30d = 0;
  let respondedWithin24h = 0;
  let responseHoursTotal = 0;
  let responseCount = 0;

  for (const post of recentDemands) {
    const created = timestamp(post.created_at);
    const firstResponse = (applicationsByPost.get(post.id) || [])
      .map(app => timestamp(app.created_at))
      .filter(value => value !== null && value >= created)
      .sort((a, b) => a - b)[0];
    if (firstResponse === undefined) continue;
    respondedRequests30d += 1;
    const hours = (firstResponse - created) / (60 * 60 * 1000);
    responseHoursTotal += hours;
    responseCount += 1;
    if (hours <= 24) respondedWithin24h += 1;
  }

  const activeDemands = demands.filter(post => post.status === 'active');
  const activeOffers = offers.filter(post => post.status === 'active');
  const activeDeals = deals.filter(deal =>
    ['accepted', 'in_progress', 'awaiting_confirmation'].includes(deal.status) &&
    (inScope(deal.buyer_id) || inScope(deal.seller_id))
  );
  const activeDealPostIds = new Set(activeDeals.map(deal => deal.post_id));
  const unansweredRequests = activeDemands.filter(post => {
    const hasPendingResponse = (applicationsByPost.get(post.id) || [])
      .some(app => app.status === 'pending');
    return !hasPendingResponse && !activeDealPostIds.has(post.id);
  });

  const categories = new Map();
  for (const post of activeDemands) {
    const key = String(post.category || 'Другое').trim() || 'Другое';
    const item = categories.get(key) || { category: key, requests: 0, offers: 0 };
    item.requests += 1;
    categories.set(key, item);
  }
  for (const post of activeOffers) {
    const key = String(post.category || 'Другое').trim() || 'Другое';
    const item = categories.get(key) || { category: key, requests: 0, offers: 0 };
    item.offers += 1;
    categories.set(key, item);
  }
  const categoryGaps = Array.from(categories.values())
    .filter(item => item.requests > item.offers)
    .sort((a, b) => (b.requests - b.offers) - (a.requests - a.offers) || b.requests - a.requests)
    .slice(0, 8);

  const completedDeals30d = deals.filter(deal => {
    if (deal.status !== 'completed' || (!inScope(deal.buyer_id) && !inScope(deal.seller_id))) return false;
    const completed = timestamp(deal.completed_at);
    return completed !== null && completed >= since && completed <= now;
  });
  const reachedStudents = new Set();
  for (const deal of completedDeals30d) {
    if (inScope(deal.buyer_id)) reachedStudents.add(deal.buyer_id);
    if (inScope(deal.seller_id)) reachedStudents.add(deal.seller_id);
  }
  const startedDeals30d = deals.filter(deal => {
    if (!inScope(deal.buyer_id) && !inScope(deal.seller_id)) return false;
    const created = timestamp(deal.created_at);
    return created !== null && created >= since && created <= now;
  });
  const openDisputes = deals.filter(deal =>
    deal.status === 'disputed' && (inScope(deal.buyer_id) || inScope(deal.seller_id))
  ).length;

  return {
    studentsCount: students.length,
    activeRequests: activeDemands.length,
    activeOffers: activeOffers.length,
    unansweredRequests: unansweredRequests.length,
    requestsCreated30d: recentDemands.length,
    respondedRequests30d,
    responseRate30d: recentDemands.length ? respondedRequests30d / recentDemands.length : null,
    respondedWithin24h,
    responseWithin24hRate: recentDemands.length ? respondedWithin24h / recentDemands.length : null,
    averageFirstResponseHours: responseCount ? responseHoursTotal / responseCount : null,
    completedDeals30d: completedDeals30d.length,
    freeHelpDeals30d: completedDeals30d.filter(deal => deal.deal_type === 'free').length,
    studentsReached30d: reachedStudents.size,
    startedDeals30d: startedDeals30d.length,
    openDisputes,
    categoryGaps
  };
}

module.exports = { buildImpactMetrics };
