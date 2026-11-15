const CONFUSABLES = Object.freeze({
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у',
  k: 'к', m: 'м', t: 'т', b: 'в', h: 'н'
});

const RULES = [
  {
    code: 'restricted_goods',
    label: 'Опасные или запрещённые товары и услуги',
    severity: 'high',
    terms: ['оруж', 'боеприпас', 'наркот', 'вейп', 'сигарет', 'алкогол', 'взрывчат', 'пистолет', 'винтовк', 'weapon', 'firearm', 'ammunition', 'vape', 'cigarette', 'drugs'],
    patterns: [/(?:продам|куплю|обменяю|достану)\s+(?:оружие|боеприпасы|наркотики|вейп|сигареты|алкоголь)/iu]
  },
  {
    code: 'account_trade',
    label: 'Торговля аккаунтами или доступом',
    severity: 'high',
    terms: ['продаюаккаунт', 'продамаккаунт', 'куплюаккаунт', 'обменяюаккаунт', 'взломаюаккаунт', 'продамлогин', 'парольотчужогоаккаунта'],
    patterns: [/(?:продаю|продам|куплю|обменяю)\s+(?:игровой\s+)?аккаунт/iu, /пароль\s+от\s+чужого\s+аккаунта/iu]
  },
  {
    code: 'personal_data',
    label: 'Запрос или публикация личных и платёжных данных',
    severity: 'high',
    terms: ['паспорт', 'cvv', 'cvc', 'номербанковскойкарты', 'домашнийадрес', 'парольотпочты', 'парольотаккаунта', 'кодизсмс'],
    patterns: [/(?:номер|данные)\s+(?:банковской\s+)?карты/iu, /(?:домашний\s+)?адрес\s+(?:проживания|дома)/iu, /(?:пароль|код)\s+(?:от|из)\s+(?:почты|аккаунта|смс)/iu, /(?:номер\s+)?(?:телефон|телефона|телефону|телефоном)\s*[:№]?\s*\+?\d[\d\s().-]{7,}\d/iu, /(?:cvv|cvc)\s*[:=]?\s*\d{3,4}/iu, /(?:\d[ -]?){13,19}/u]
  },
  {
    code: 'academic_cheating',
    label: 'Предложение выполнить оценочную работу вместо ученика',
    severity: 'medium',
    terms: ['готовыеответы', 'сделаюконтрольную', 'напишуконтрольную', 'напишуэкзамен', 'спишузавас', 'купитьответы', 'домашкузаввас'],
    patterns: [/(?:сделаю|напишу|решу)\s+(?:за\s+вас\s+)?(?:контрольную|экзамен|тест)/iu, /(?:спишу|куплю)\s+(?:за\s+вас\s+)?(?:ответы|домашнюю\s+работу)/iu]
  },
  {
    code: 'financial_scam',
    label: 'Подозрительные обещания дохода или переводов',
    severity: 'medium',
    terms: ['гарантированныйдоход', 'удвоюденьги', 'быстрыйзаработок', 'безриска', 'переведиденьги', 'скиньпредоплату'],
    patterns: [/(?:гарантированн\p{L}*\s+доход|удвою\s+деньги|быстрый\s+заработок|заработок\s+без\s+риска)/iu]
  },
  {
    code: 'threats_harassment',
    label: 'Возможные угрозы или травля',
    severity: 'high',
    terms: ['убьютебя', 'найдуитебя', 'угрожаю', 'травля', 'шантаж', 'вымогательство'],
    patterns: [/(?:я\s+)?(?:убью|изобью|найду\s+и\s+накажу)\s+тебя/iu]
  }
];

function normalize(value) {
  return String(value || '')
    .slice(0, 5000)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function analyseText(value) {
  const normalized = normalize(value);
  const confusable = normalized.replace(/[aeopcxykmtbh]/g, char => CONFUSABLES[char]);
  const variants = [normalized, confusable];
  const compactVariants = variants.map(text => text.replace(/[^\p{L}\p{N}]+/gu, ''));
  const findings = [];

  for (const rule of RULES) {
    const matched = rule.patterns.some(pattern => variants.some(text => pattern.test(text))) ||
      rule.terms.some(term => compactVariants.some(compact => compact.includes(term.replace(/[^\p{L}\p{N}]+/gu, ''))));
    if (matched) findings.push({
      code: rule.code,
      label: rule.label,
      severity: rule.severity
    });
  }

  const level = findings.some(item => item.severity === 'high')
    ? 'high'
    : findings.length ? 'medium' : 'low';

  return {
    level,
    findings,
    requiresReview: level !== 'low',
    recommendation: level === 'high'
      ? 'Скрыть публикацию до обязательной ручной проверки. Не блокировать автора автоматически.'
      : level === 'medium'
        ? 'Поместить публикацию в очередь ручной проверки до показа другим пользователям.'
        : 'Совпадений не найдено; это не заменяет обычную проверку жалоб.',
    disclaimer: 'Это предварительный фильтр по тексту. Совпадение не доказывает нарушение; решение принимает человек.'
  };
}

module.exports = { analyseText, normalize };
