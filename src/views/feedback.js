const { esc } = require('../utils/http');
function msgText(code) {
  return ({
    purchased: 'Покупка создана. Токены заблокированы в escrow.',
    confirmed: 'Сделка подтверждена, расчёт выполнен.',
    delivered: 'Выполнение отмечено. Ожидается подтверждение.',
    created: 'Публикация создана.',
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
    cancelled: 'Заявка отменена.',
    pending_review: 'Публикация отправлена на ручную проверку.',
    sent: 'Отклик отправлен автору публикации.',
    declined: 'Отклик отклонён.',
    reviewed: 'Решение модератора сохранено.',
    read: 'Уведомления отмечены прочитанными.',
    reported: 'Жалоба зарегистрирована.',
    disputed: 'По заказу открыт спор, он передан на рассмотрение.',
    closed: 'Публикация закрыта.',
    scan: 'Повторная проверка публикаций завершена.',
    sandbox_created: 'Создана тестовая операция. Баланс ScRl не изменён.'
  })[code] || code;
}

function errText(code) {
  return ({
    insufficient: 'Недостаточно токенов.',
    age: 'Действие недоступно по возрасту или роли.',
    own: 'Нельзя купить собственное объявление.',
    bad: 'Некорректный запрос.',
    limit: 'Недельный лимит исчерпан.',
    notfound: 'Объект не найден.',
    ended: 'Аукцион завершён.',
    low: 'Ставка ниже минимально допустимой.',
    email: 'Email уже занят.',
    fields: 'Проверьте заполнение полей.',
    novrub: 'Недостаточно виртуальных рублей.',
    wrong: 'Неверный email или пароль.',
    blocked_acc: 'Аккаунт заблокирован.',
    disabled: 'Платёжный модуль сейчас отключён.',
    pending: 'Операция ожидает проверки.',
    disputed: 'По сделке открыт спор.',
    hold: 'Не удалось зарезервировать токены. Баланс не должен был измениться.',
    refund: 'Не удалось подтвердить возврат. Обратитесь к администратору.',
    escrow: 'Резерв сделки не совпадает с журналом. Операция остановлена.',
    escrow_mismatch: 'Зарезервированная сумма не совпадает с суммой конкретной сделки. Выплата остановлена.',
    settlement: 'Расчёт не завершён. Не повторяйте действие многократно; проверьте журнал.',
    ledger: 'Системный счёт недоступен. Обратитесь к администратору.',
    order: 'Данные заявки повреждены или некорректны.',
    price_range: 'Цена должна находиться внутри указанного диапазона.',
    already_accepted: 'Для этой публикации уже существует активная сделка.',
    amount: 'Укажите допустимую целую сумму.',
    already_settled: 'Эта сделка уже рассчитана другим решением.',
    deal_state: 'Статус сделки изменился. Обновите страницу.',
    deal_amount: 'Некорректная сумма сделки.',
    case_kind: 'Неизвестный тип обращения.',
    decision: 'Недопустимое решение модератора.',
    invalid_auction: 'У аукциона некорректная дата завершения.',
    trade: 'Обмен не выполнен. Средства не должны были списаться.'
  })[code] || code;
}

function flashBox(url) {
  const msg = url.searchParams.get('msg');
  const err = url.searchParams.get('error');
  if (msg === 'scan') {
    const scannedValue = Number(url.searchParams.get('scanned') || 0);
    const flaggedValue = Number(url.searchParams.get('flagged') || 0);
    const scanned = Number.isSafeInteger(scannedValue) ? Math.max(0, Math.min(1000000, scannedValue)) : 0;
    const flagged = Number.isSafeInteger(flaggedValue) ? Math.max(0, Math.min(1000000, flaggedValue)) : 0;
    return `<div class="alert alert-success">Повторная проверка завершена. Проверено: ${scanned}. На ручную проверку отправлено: ${flagged}.</div>`;
  }
  if (msg) return `<div class="alert alert-success">${esc(msgText(msg))}</div>`;
  if (err) return `<div class="alert alert-danger">${esc(errText(err))}</div>`;
  return '';
}


module.exports = { msgText, errText, flashBox };
