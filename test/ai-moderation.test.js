const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeModerationInput,
  parseModelResult,
  mergeResults,
  getApiConfig,
  analyseSubmission
} = require('../src/services/ai-moderation');
const { analyseText } = require('../src/services/moderation-rules');

function withOpenRouterEnv(run) {
  const previousEnabled = process.env.SCRL_AI_MODERATION_ENABLED;
  const previousKey = process.env.SCRL_OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  process.env.SCRL_AI_MODERATION_ENABLED = 'true';
  process.env.SCRL_OPENROUTER_API_KEY = 'test-openrouter-key';
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previousEnabled === undefined) delete process.env.SCRL_AI_MODERATION_ENABLED;
      else process.env.SCRL_AI_MODERATION_ENABLED = previousEnabled;
      if (previousKey === undefined) delete process.env.SCRL_OPENROUTER_API_KEY;
      else process.env.SCRL_OPENROUTER_API_KEY = previousKey;
      global.fetch = originalFetch;
    });
}

test('redacts contact and personal details before external moderation', () => {
  const safe = sanitizeModerationInput(
    'Свяжись: test@example.com, +7 999 123-45-67, https://example.com, @student42, мой адрес: ул. Ленина, 12'
  );
  assert.doesNotMatch(safe, /test@example\.com|999 123-45-67|https:\/\/example\.com|@student42|ул\. Ленина/);
  assert.match(safe, /\[EMAIL\]/);
  assert.match(safe, /\[PHONE\]/);
  assert.match(safe, /\[LINK\]/);
  assert.match(safe, /\[MENTION\]/);
  assert.match(safe, /\[PERSONAL_DATA\]/);
});

test('accepts only strict keep/review decisions and known categories', () => {
  const keep = parseModelResult({
    choices: [{ message: { content: '{"decision":"keep","categories":[]}' } }]
  });
  assert.equal(keep.decision, 'keep');
  assert.equal(keep.requiresReview, false);

  const review = parseModelResult({
    choices: [{ message: { content: '{"decision":"review","categories":["restricted_trade"]}' } }]
  });
  assert.equal(review.decision, 'review');
  assert.equal(review.level, 'high');
  assert.equal(review.requiresReview, true);
  assert.equal(review.findings.length, 1);
  assert.equal(review.findings[0].code, 'ai_restricted_trade');

  assert.equal(parseModelResult({
    choices: [{ message: { content: '{"decision":"maybe","categories":[]}' } }]
  }), null);
  assert.equal(parseModelResult({
    choices: [{ message: { content: '{"decision":"review","categories":["unknown"]}' } }]
  }), null);
  assert.equal(parseModelResult({
    choices: [{ message: { content: '{"decision":"keep","categories":["scam"]}' } }]
  }), null);
});

test('keeps local high-risk decisions even if the model says keep', () => {
  const local = analyseText('Доставка пиццы (и пива)');
  const ai = parseModelResult({
    choices: [{ message: { content: '{"decision":"keep","categories":[]}' } }]
  });
  const combined = mergeResults(local, ai);
  assert.equal(combined.level, 'high');
  assert.equal(combined.decision, 'review');
  assert.equal(combined.requiresReview, true);
});

test('routes a model review verdict to the human moderation queue', () => {
  const local = analyseText('Помогу разобраться с Python на примерах');
  const ai = parseModelResult({
    choices: [{ message: { content: '{"decision":"review","categories":["academic_cheating"]}' } }]
  });
  const combined = mergeResults(local, ai);
  assert.equal(combined.level, 'medium');
  assert.equal(combined.decision, 'review');
  assert.equal(combined.requiresReview, true);
});

test('uses OpenRouter free auto-router with strict provider privacy controls', async () => {
  await withOpenRouterEnv(async () => {
    let capturedUrl = '';
    let capturedBody = null;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"decision":"keep","categories":[]}' } }]
        })
      };
    };

    const config = getApiConfig();
    assert.equal(config.model, 'openrouter/free');
    const result = await analyseSubmission('Помогу разобраться с Python на примерах');

    assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(capturedBody.model, 'openrouter/free');
    assert.deepEqual(capturedBody.provider, { zdr: true, data_collection: 'deny' });
    assert.equal(result.decision, 'keep');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'model'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'provider'), false);
  });
});

test('fails closed to manual review when the AI endpoint is unavailable', async () => {
  await withOpenRouterEnv(async () => {
    global.fetch = async () => ({ ok: false, status: 429 });
    const result = await analyseSubmission('Безопасное описание учебной помощи');
    assert.equal(result.decision, 'review');
    assert.equal(result.requiresReview, true);
    assert.ok(result.findings.some(item => item.code === 'ai_unavailable'));
  });
});
