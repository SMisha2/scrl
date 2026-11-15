const { state } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { layout } = require('../views/layout');
const { buildImpactMetrics } = require('../services/impact-metrics');

function metricCard(label, value, hint) {
  return '<section class="card metric"><div class="muted small">' + label + '</div>' +
    '<div class="value">' + value + '</div><p class="muted small">' + hint + '</p></section>';
}

function pageImpact(res, user) {
  if (!user || !['admin', 'teacher'].includes(user.role)) return redirect(res, '/');
  const students = state.users.filter(person =>
    person.role === 'student' && (user.role === 'admin' || (user.class_name && person.class_name === user.class_name))
  );
  const members = new Set(students.map(person => person.id));
  const metrics = buildImpactMetrics({
    students,
    demands: state.demand_posts || [],
    offers: state.offer_posts || [],
    applications: state.applications || [],
    deals: state.deals || []
  });

  const scopeLabel = user.role === 'admin' ? 'Весь лицей' : 'Класс ' + (user.class_name || 'не указан');
  const responseRate = metrics.responseRate30d === null ? 'Нет данных' : Math.round(metrics.responseRate30d * 100) + '%';
  const responseSpeed = metrics.averageFirstResponseHours === null
    ? 'Нет данных'
    : metrics.averageFirstResponseHours < 1
      ? Math.round(metrics.averageFirstResponseHours * 60) + ' мин'
      : metrics.averageFirstResponseHours.toFixed(1).replace('.', ',') + ' ч';
  const withinDay = metrics.responseWithin24hRate === null ? 'Нет данных' : Math.round(metrics.responseWithin24hRate * 100) + '%';

  const gaps = metrics.categoryGaps.map(item =>
    '<tr><td><b>' + esc(item.category) + '</b></td><td>' + item.requests + '</td><td>' + item.offers + '</td><td>' +
      (item.offers === 0 ? '<span class="badge badge-accent">Нет предложения</span>' : '<span class="badge badge-muted">Спрос выше</span>') +
    '</td></tr>'
  ).join('');

  const recommendations = [];
  if (metrics.unansweredRequests > 0) {
    recommendations.push('<div class="alert alert-info">Есть <b>' + metrics.unansweredRequests +
      '</b> запросов без отклика.</div>');
  }
  if (metrics.categoryGaps.some(item => item.offers === 0)) {
    recommendations.push('<div class="alert alert-info">В некоторых категориях нет предложений помощи.</div>');
  }
  if (!metrics.requestsCreated30d && !metrics.activeOffers) {
    recommendations.push('<div class="alert alert-info">Пока недостаточно данных для выводов.</div>');
  }
  if (metrics.openDisputes > 0) {
    recommendations.push('<div class="alert alert-danger">Открытые споры требуют проверки.</div>');
  }

  const content = '<div class="row-between"><div><h1>Пульс лицея</h1></div>' +
    '<span class="badge badge-primary-soft">' + esc(scopeLabel) + '</span></div>' +
    '<section class="card"><div class="row-between"><div><h2>Показатели за 30 дней</h2></div>' +
    '<span class="badge badge-muted">' + metrics.studentsCount + ' учеников в области подсчёта</span></div>' +
    '<div class="grid grid-4 mt-2">' +
      metricCard('Завершённые договорённости', metrics.completedDeals30d, 'Подтверждены обеими сторонами') +
      metricCard('Участники помощи', metrics.studentsReached30d, 'Уникальные участники завершённых договорённостей') +
      metricCard('Бесплатная помощь', metrics.freeHelpDeals30d, 'Завершённые бесплатные договорённости') +
      metricCard('Запросы с откликом', responseRate, metrics.respondedRequests30d + ' из ' + metrics.requestsCreated30d + ' новых запросов') +
    '</div></section>' +
    '<div class="grid grid-3">' +
      metricCard('Активные запросы', metrics.activeRequests, 'Нужна помощь сейчас') +
      metricCard('Без ожидающего отклика', metrics.unansweredRequests, 'Приоритет для внимания') +
      metricCard('Активные предложения', metrics.activeOffers, 'Готовы помочь') +
    '</div>' +
    '<div class="grid grid-2"><section class="card"><h2>Скорость ответа</h2><div class="grid grid-2">' +
      '<div><div class="muted small">Среднее до первого отклика</div><div class="value">' + responseSpeed + '</div></div>' +
      '<div><div class="muted small">Отклик в течение суток</div><div class="value">' + withinDay + '</div></div>' +
    '</div></section>' +
    '<section class="card"><h2>Что стоит улучшить</h2>' +
      (recommendations.join('') || '<p class="muted">Срочных сигналов нет.</p>') +
    '</section></div>' +
    '<section class="card"><h2>Дефицит предложений</h2>' +
    (gaps ? '<table><thead><tr><th>Категория</th><th>Запросы</th><th>Предложения</th><th>Сигнал</th></tr></thead><tbody>' + gaps + '</tbody></table>' :
      '<p class="muted mt-1">Сейчас нет категорий с перевесом запросов над предложениями.</p>') +
    '</section>' +
    '<details class="card"><summary>Методика расчёта</summary><ul class="muted small" style="padding-left:20px;display:grid;gap:6px">' +
    '<li>Завершённая договорённость означает, что участники сами подтвердили выполнение внутри ScRl; это не независимая проверка качества помощи.</li>' +
    '<li>Один человек может участвовать в нескольких договорённостях, но в метрике охвата считается один раз.</li>' +
    '<li>Количество ScRl, торгов и регистраций не считается доказательством пользы для лицея.</li>' +
    '<li>Показываются только агрегированные числа, имена учеников и содержание их запросов здесь не раскрываются.</li>' +
    '</ul></details>' +
    '<div class="row"><a class="btn btn-primary" href="' + (user.role === 'admin' ? '/admin' : '/teacher') + '">Вернуться в кабинет</a>' +
    (user.role === 'admin' ? '<a class="btn btn-ghost" href="/admin/moderation">Проверить спорные ситуации</a>' : '') + '</div>';

  sendHtml(res, layout('Пульс лицея', user, content));
}

module.exports = { pageImpact };
