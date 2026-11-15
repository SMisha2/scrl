function recommendHelpOffers({ user, demandPosts, offerPosts, users, canTradeUser, limit = 3 }) {
  if (!user || !Array.isArray(demandPosts) || !Array.isArray(offerPosts) || !Array.isArray(users)) return [];
  const normalize = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
  const requests = demandPosts.filter(post =>
    post.user_id === user.id && post.status === 'active' && normalize(post.category)
  );
  if (!requests.length) return [];

  const userById = new Map(users.map(person => [person.id, person]));
  const offers = offerPosts.filter(post => {
    if (post.status !== 'active' || post.user_id === user.id) return false;
    const author = userById.get(post.user_id);
    if (!author || author.is_blocked) return false;
    return post.price_mode === 'free' || (canTradeUser(user) && canTradeUser(author));
  });

  const matches = [];
  const used = new Set();
  for (const request of requests) {
    const category = normalize(request.category);
    for (const offer of offers) {
      if (used.has(offer.id) || normalize(offer.category) !== category) continue;
      const author = userById.get(offer.user_id);
      matches.push({ offer, request, author });
      used.add(offer.id);
    }
  }
  const maximum = Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, 10)) : 3;
  return matches.sort((a, b) =>
    Number(a.offer.price_mode !== 'free') - Number(b.offer.price_mode !== 'free') ||
    String(b.offer.created_at || '').localeCompare(String(a.offer.created_at || ''))
  ).slice(0, maximum);
}

module.exports = { recommendHelpOffers };
