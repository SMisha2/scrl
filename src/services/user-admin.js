function changeUserRole(target, nextRole, className) {
  if (!target || target.deleted_at || !['student', 'teacher'].includes(target.role)) {
    const error = new Error('Protected user account');
    error.code = 'protected';
    throw error;
  }
  if (!['student', 'teacher'].includes(nextRole)) {
    const error = new Error('Invalid role');
    error.code = 'bad_role';
    throw error;
  }
  const normalizedClass = String(className || '').trim().slice(0, 20);
  if (nextRole === 'teacher' &&
      (!normalizedClass || /[\r\n<>]/.test(normalizedClass))) {
    const error = new Error('Teacher class is required');
    error.code = 'teacher_class';
    throw error;
  }
  const previousRole = target.role;
  target.role = nextRole;
  if (nextRole === 'teacher') target.class_name = normalizedClass;
  return { previousRole, role: nextRole, className: target.class_name || '' };
}

function anonymizeUser(target, details) {
  if (!target || target.deleted_at || !['student', 'teacher'].includes(target.role)) {
    const error = new Error('Protected user account');
    error.code = 'protected';
    throw error;
  }
  const reason = String(details.reason || '').trim().slice(0, 300);
  if (!reason || !details.actorId || !details.now || !details.passwordHash) {
    const error = new Error('Missing deletion details');
    error.code = 'fields';
    throw error;
  }
  target.deleted_at = details.now;
  target.deleted_by = details.actorId;
  target.delete_reason = reason;
  // Keep the original role for ledger and market accounting. deleted_at blocks access.
  target.email = 'deleted+' + target.id + '@deleted.invalid';
  target.full_name = 'Удалённый пользователь';
  target.class_name = null;
  target.birth_date = null;
  target.password_hash = details.passwordHash;
  target.is_blocked = true;
  target.block_reason = 'Аккаунт удалён администратором';
  return target;
}

module.exports = { changeUserRole, anonymizeUser };
