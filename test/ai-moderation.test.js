const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeModerationInput,
  parseModelResult,
  mergeResults
} = require('../src/services/ai-moderation');
const { analyseText } = require('../src/services/moderation-rules');

test('redacts contact details before sending text to external moderation', () => {
  const safe = sanitizeModerationInput('Свяжись: test@example.com, +7 999 123-45-67, https://example.com, @student42');
  assert.doesNotMatch(safe, /test@example\.com|999 123-45-67|https:\/\/example\.com|@student42/);
  assert.match(safe, /\[EMAIL\]/);
  assert.match(safe, /\[PHONE\]/);
  assert.match(safe, /\[LINK\]/);
  assert.match(safe, /\[MENTION\]/);
});

test('accepts only known categories and valid levels from model output', () => {
  const result = parseModelResult({
    choices: [{ message: { content: '{"level":"high","categories":["restricted_trade","unknown"]}' } }]
  });
  assert.equal(result.level, 'high');
  assert.equal(result.requiresReview, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'ai_restricted_trade');

  assert.equal(parseModelResult({
    choices: [{ message: { content: '{"level":"critical","categories":["restricted_trade"]}' } }]
  }), null);
});

test('keeps local high-risk decisions even if the model says low risk', () => {
  const local = analyseText('Доставка пиццы (и пива)');
  const ai = parseModelResult({
    choices: [{ message: { content: '{"level":"low","categories":[]}' } }]
  });
  const combined = mergeResults(local, ai);
  assert.equal(combined.level, 'high');
  assert.equal(combined.requiresReview, true);
});

test('routes model-flagged medium content into human review', () => {
  const local = analyseText('Помогу разобраться с Python на примерах');
  const ai = parseModelResult({
    choices: [{ message: { content: '{"level":"medium","categories":["academic_cheating"]}' } }]
  });
  const combined = mergeResults(local, ai);
  assert.equal(combined.level, 'medium');
  assert.equal(combined.requiresReview, true);
});
