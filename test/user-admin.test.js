const test = require('node:test');
const assert = require('node:assert/strict');
const { changeUserRole, anonymizeUser, hasOpenActivities } = require('../src/services/user-admin');

test('administrator can assign a student to a teacher role and class', () => {
  const user = { id: 'u1', role: 'student', class_name: '8А' };
  const result = changeUserRole(user, 'teacher', '9Б');
  assert.equal(result.previousRole, 'student');
  assert.equal(user.role, 'teacher');
  assert.equal(user.class_name, '9Б');
});

test('teacher can be returned to the student role without losing their class', () => {
  const user = { id: 'u2', role: 'teacher', class_name: '7В' };
  changeUserRole(user, 'student', '');
  assert.equal(user.role, 'student');
  assert.equal(user.class_name, '7В');
});

test('teacher assignment requires a valid class value', () => {
  const user = { id: 'u3', role: 'student', class_name: '8А' };
  assert.throws(() => changeUserRole(user, 'teacher', ''), { code: 'teacher_class' });
  assert.throws(() => changeUserRole(user, 'teacher', '8А\nadmin'), { code: 'teacher_class' });
});

test('admin and already removed accounts cannot be changed by the ordinary role action', () => {
  assert.throws(() => changeUserRole({ id: 'root', role: 'admin' }, 'teacher', '8А'), { code: 'protected' });
  assert.throws(() => changeUserRole({ id: 'gone', role: 'deleted', deleted_at: 'now' }, 'student', ''), { code: 'protected' });
});

test('account removal anonymizes sign-in details but keeps the user id for historical records', () => {
  const user = {
    id: 'u4', role: 'student', email: 'student@example.test', full_name: 'Иван Иванов',
    class_name: '8А', birth_date: '2010-01-01', password_hash: 'old-hash',
    is_blocked: false
  };
  anonymizeUser(user, {
    actorId: 'admin-1', reason: 'Запрос администрации', now: '2026-11-15T00:00:00.000Z',
    passwordHash: 'new-unusable-hash'
  });
  assert.equal(user.id, 'u4');
  assert.equal(user.role, 'student');
  assert.ok(user.deleted_at);
  assert.equal(user.email, 'deleted+u4@deleted.invalid');
  assert.equal(user.full_name, 'Удалённый пользователь');
  assert.equal(user.class_name, null);
  assert.equal(user.birth_date, null);
  assert.equal(user.password_hash, 'new-unusable-hash');
  assert.equal(user.is_blocked, true);
  assert.equal(user.deleted_by, 'admin-1');
  assert.equal(user.delete_reason, 'Запрос администрации');
});

test('account removal requires a reason', () => {
  assert.throws(() => anonymizeUser({ id: 'u5', role: 'student' }, {
    actorId: 'admin-1', reason: '', now: '2026-11-15T00:00:00.000Z', passwordHash: 'hash'
  }), { code: 'fields' });
});

test('account removal is blocked while deals or marketplace orders are open', () => {
  assert.equal(hasOpenActivities('u6', [
    { buyer_id: 'u6', seller_id: 'u7', status: 'in_progress' }
  ], []), true);
  assert.equal(hasOpenActivities('u6', [], [
    { buyer_id: 'u7', seller_id: 'u6', status: 'disputed' }
  ]), true);
  assert.equal(hasOpenActivities('u6', [
    { buyer_id: 'u6', seller_id: 'u7', status: 'completed' }
  ], [
    { buyer_id: 'u7', seller_id: 'u6', status: 'refunded' }
  ]), false);
});
