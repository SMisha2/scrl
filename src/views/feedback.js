const { esc } = require('../utils/http');
function msgText(m) {
  return ({
    purchased: 'Заказ создан. Токены заблокированы в escrow.',
    confirmed: 'Заказ подтверждён. Комиссия сожжена.',
    delivered: 'Отмечено как выполнено.',
    created: 'Объявление создано.',
    deleted: 'Объявление удалено.',
    issued: 'Токены начислены.',
    credited: 'Токены начислены.',
    debited: 'Токены списаны.',
    blocked: 'Пользователь заблокирован.',
    unblocked: 'Пользователь разблокирован.',
    bid: 'Ставка принята.',
    auction_created: 'Аукцион создан.',
    auction_finished: 'Аукцион завершён.',
    registered: 'Аккаунт создан. Начислено 100 ScRl.',
    sold: 'Заявка на продажу создана.',
    bought: 'Сделка совершена.',
    cancelled: 'Заявка отменена.'
  })[m] || m;
}

function errText(e) {
  return ({
    insufficient: 'Недостаточно токенов.',
    age: 'Действие недоступно по возрасту или роли.',
    own: 'Нельзя купить своё объявление.',
    bad: 'Некорректный запрос.',
    limit: 'Недельный лимит исчерпан.',
    notfound: 'Не найдено.',
    ended: 'Аукцион завершён.',
    low: 'Ставка слишком низкая.',
    email: 'Email уже занят.',
    fields: 'Заполните все поля.',
    novrub: 'Недостаточно виртуальных рублей.',
    wrong: 'Неверный email или пароль.',
    blocked_acc: 'Аккаунт заблокирован.'
  })[e] || e;
}

function flashBox(url) {
  const msg = url.searchParams.get('msg');
  const err = url.searchParams.get('error');
  if (msg) return `<div class="alert alert-success">${esc(msgText(msg))}</div>`;
  if (err) return `<div class="alert alert-danger">${esc(errText(err))}</div>`;
  return '';
}


module.exports = { msgText, errText, flashBox };
