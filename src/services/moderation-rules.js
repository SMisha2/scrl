const RULES = [
  { label: 'Запрещённая торговля или опасные товары', severity: 'high', pattern: /\b(оружи|боеприпас|наркот|вейп|сигарет|алкогол|взлом аккаунт|куплю аккаунт|продам аккаунт)\w*/i },
  { label: 'Риск академической недобросовестности', severity: 'medium', pattern: /\b(готовые ответы|сделаю контрольную|напишу экзамен|спишу за вас|купить ответы)\b/i },
  { label: 'Возможная передача персональных данных', severity: 'high', pattern: /\b(паспорт|номер карты|cvv|домашний адрес|пароль от)\b/i },
  { label: 'Подозрительные обещания быстрого дохода', severity: 'medium', pattern: /\b(гарантированн\w* доход|удвою деньги|быстрый заработок|без риска)\b/i }
];

function analyseText(value) {
  const text = String(value || '').slice(0, 5000);
  const findings = RULES.filter(rule => rule.pattern.test(text)).map(rule => ({
    label: rule.label,
    severity: rule.severity
  }));
  const level = findings.some(x => x.severity === 'high')
    ? 'high'
    : findings.length ? 'medium' : 'low';
  return {
    level,
    findings,
    recommendation: level === 'high'
      ? 'Передать на обязательную ручную проверку и временно скрыть публикацию'
      : level === 'medium'
        ? 'Проверить формулировки вручную'
        : 'Автоматические правила не нашли явных совпадений; обычная модерация всё равно применяется',
    disclaimer: 'Это предварительный фильтр по ключевым признакам, а не установление нарушения или виновности пользователя.'
  };
}

module.exports = { analyseText };
