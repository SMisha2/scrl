const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseText } = require('../src/services/moderation-rules');

test('recognizes Russian prohibited-goods terms', () => {
  const result = analyseText('Продаю вейп, пишите в личные сообщения');
  assert.equal(result.level, 'high');
  assert.ok(result.findings.some(item => item.code === 'restricted_goods'));
  assert.equal(result.requiresReview, true);
});

test('recognizes spaced and visually obfuscated Russian text', () => {
  assert.equal(analyseText('н а р к о т и к и').level, 'high');
  assert.equal(analyseText('продaю аккaунт').level, 'high');
});

test('recognizes personal and payment data patterns', () => {
  assert.ok(analyseText('Напиши CVV карты и пароль от почты').findings.some(x => x.code === 'personal_data'));
  assert.ok(analyseText('Номер телефона: +7 999 123-45-67').findings.some(x => x.code === 'personal_data'));
  assert.ok(analyseText('Номер телефона +7 999 123-45-67').findings.some(x => x.code === 'personal_data'));
});

test('puts academic dishonesty into manual review, not automatic punishment', () => {
  const result = analyseText('Сделаю контрольную за вас');
  assert.equal(result.level, 'medium');
  assert.match(result.recommendation, /ручной проверки/iu);
});

test('does not flag an ordinary learning offer', () => {
  const result = analyseText('Помогу разобраться с Python: объясню функции и списки на примерах.');
  assert.equal(result.level, 'low');
  assert.deepEqual(result.findings, []);
});

test('flags alcohol delivery and beverage offers before publication', () => {
  const result = analyseText('Доставка пиццы (и пива)');
  assert.equal(result.level, 'high');
  assert.equal(result.requiresReview, true);
  assert.ok(result.findings.some(item => item.code === 'restricted_goods'));

  for (const text of ['Продам сидр', 'Доставка водки', 'Шампанское к празднику']) {
    const flagged = analyseText(text);
    assert.equal(flagged.level, 'high', text);
    assert.ok(flagged.findings.some(item => item.code === 'restricted_goods'), text);
  }
});

test('does not flag ordinary words that only resemble alcohol terms', () => {
  assert.equal(analyseText('Я виноват, что не пришёл').level, 'low');
  assert.equal(analyseText('Люблю ромашки в саду').level, 'low');
});
