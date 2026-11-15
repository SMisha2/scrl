const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeModerationInput,
  parseModelResult,
  mergeResults,
  getApiConfig,
  tokenExpiryMs,
  analyseSubmission
} = require('../src/services/ai-moderation');
const { analyseText } = require('../src/services/moderation-rules');

function withGigaChatEnv(run) {
  const previousEnabled = process.env.SCRL_AI_MODERATION_ENABLED;
  const previousKey = process.env.SCRL_GIGACHAT_AUTH_KEY;
  const previousModel = process.env.SCRL_GIGACHAT_MODEL;
  const originalFetch = global.fetch;
  process.env.SCRL_AI_MODERATION_ENABLED = 'true';
  process.env.SCRL_GIGACHAT_AUTH_KEY = 'test-gigachat-auth-key-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  delete process.env.SCRL_GIGACHAT_MODEL;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previousEnabled === undefined) delete process.env.SCRL_AI_MODERATION_ENABLED;
      else process.env.SCRL_AI_MODERATION_ENABLED = previousEnabled;
      if (previousKey === undefined) delete process.env.SCRL_GIGACHAT_AUTH_KEY;
      else process.env.SCRL_GIGACHAT_AUTH_KEY = previousKey;
      if (previousModel === undefined) delete process.env.SCRL_GIGACHAT_MODEL;
      else process.env.SCRL_GIGACHAT_MODEL = previousModel;
      global.fetch = originalFetch;
    });
}

function oauthResponse() {
  // GigaChat has returned expires_at in seconds in some API responses.
  // A near-expiry value intentionally makes the next test obtain a fresh token.
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'test-access-token',
      expires_at: Math.floor(Date.now() / 1000) + 1
    })
  };
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

test('converts GigaChat token expiry values in seconds and milliseconds', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const secondsExpiry = nowSeconds + 1800;
  const millisecondsExpiry = (nowSeconds + 1800) * 1000;
  assert.equal(tokenExpiryMs(secondsExpiry), secondsExpiry * 1000);
  assert.equal(tokenExpiryMs(millisecondsExpiry), millisecondsExpiry);
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

test('uses GigaChat OAuth and the chat completion API for safe submissions', async () => {
  await withGigaChatEnv(async () => {
    const calls = [];
    process.env.SCRL_GIGACHAT_MODEL = 'GigaChat';
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (String(url).includes('/api/v2/oauth')) return oauthResponse();
      if (String(url).endsWith('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'GigaChat-2' }, { id: 'GigaChat-2-Pro' }] })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"decision":"keep","categories":[]}' } }]
        })
      };
    };

    const config = getApiConfig();
    assert.equal(config.model, 'GigaChat');
    assert.equal(config.modelsEndpoint, 'https://api.giga.chat/v1/models');
    assert.equal(config.provider, 'gigachat');

    const result = await analyseSubmission('Помогу разобраться с Python на примерах');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth');
    assert.match(calls[0].options.headers.Authorization, /^Basic test-gigachat-auth-key-/);
    assert.equal(calls[0].options.headers.RqUID.length, 36);
    assert.equal(calls[0].options.body, 'scope=GIGACHAT_API_PERS');
    assert.equal(calls[1].url, 'https://api.giga.chat/v1/models');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer test-access-token');
    assert.equal(calls[2].url, 'https://api.giga.chat/v1/chat/completions');
    assert.equal(calls[2].options.headers.Authorization, 'Bearer test-access-token');
    const body = JSON.parse(calls[2].options.body);
    assert.equal(body.model, 'GigaChat-2-Pro');
    assert.equal(body.temperature, 0);
    assert.equal(result.decision, 'keep');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'model'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'provider'), false);
  });
});

test('retries OAuth once after an expired access token', async () => {
  await withGigaChatEnv(async () => {
    let chatCalls = 0;
    let oauthCalls = 0;
    global.fetch = async url => {
      if (String(url).includes('/api/v2/oauth')) {
        oauthCalls += 1;
        return oauthResponse();
      }
      if (String(url).endsWith('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'GigaChat-2' }] }) };
      }
      chatCalls += 1;
      if (chatCalls === 1) return { ok: false, status: 401 };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"decision":"keep","categories":[]}' } }]
        })
      };
    };
    const result = await analyseSubmission('Безопасное описание учебной помощи');
    assert.equal(oauthCalls, 2);
    assert.equal(chatCalls, 2);
    assert.equal(result.decision, 'keep');
  });
});

test('fails closed to manual review when GigaChat is unavailable', async () => {
  await withGigaChatEnv(async () => {
    global.fetch = async url => {
      if (String(url).includes('/api/v2/oauth')) return oauthResponse();
      if (String(url).endsWith('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'GigaChat-2' }] }) };
      }
      return { ok: false, status: 503 };
    };
    const result = await analyseSubmission('Безопасное описание учебной помощи');
    assert.equal(result.decision, 'review');
    assert.equal(result.requiresReview, true);
    assert.ok(result.findings.some(item => item.code === 'ai_unavailable'));
  });
});

test('fails closed when the GigaChat OAuth service cannot issue a token', async () => {
  await withGigaChatEnv(async () => {
    global.fetch = async () => ({ ok: false, status: 401 });
    const result = await analyseSubmission('Безопасное описание учебной помощи');
    assert.equal(result.decision, 'review');
    assert.equal(result.requiresReview, true);
    assert.ok(result.findings.some(item => item.code === 'ai_unavailable'));
  });
});
