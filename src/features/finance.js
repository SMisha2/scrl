const crypto = require('node:crypto');
const { state, save } = require('../store');
const { esc, sendHtml, redirect } = require('../utils/http');
const { layout } = require('../views/layout');

function paymentMode() {
  return process.env.PAYMENTS_MODE === 'sandbox' ? 'sandbox' : 'disabled';
}

function pageRubWallet(res,user) {
  if(user.role!=='student') return redirect(res,'/');
  const mode=paymentMode();
  const operations=state.money_operations.filter(x=>x.user_id===user.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const rows=operations.map(x=>'<tr><td>'+new Date(x.created_at).toLocaleString('ru-RU')+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.amount_rub)+' RUB</td><td><span class="badge badge-muted">'+esc(x.status)+'</span></td></tr>').join('');
  const status=mode==='sandbox'
    ? '<div class="alert alert-info">SANDBOX: тестовый режим. Реальные деньги не переводятся. Тестовая заявка не создаёт и не начисляет ScRl.</div>'
    : '<div class="alert alert-warning">Платёжный модуль не подключён. Пополнение и вывод реальных рублей недоступны.</div>';
  const testForm=mode==='sandbox'
    ? '<form method="POST" action="/wallet/rub/topup"><label>Тестовая сумма, RUB</label><input name="amount" type="number" min="1" max="10000" required><button class="btn btn-primary">Создать тестовую заявку</button></form>'
    : '<button class="btn btn-ghost" disabled>Пополнение недоступно</button>';
  sendHtml(res,layout('RUB операции',user,'<h1>RUB операции</h1><p class="muted">Рублёвые операции учитываются отдельно от внутреннего баланса ScRl.</p>'+status+'<div class="card"><h2>Пополнение</h2>'+testForm+'<hr><h2>Вывод</h2><p class="muted">Вывод заблокирован до подключения уполномоченного платёжного партнёра, проверки происхождения токенов, возраста, согласий и юридического допуска.</p><button class="btn btn-ghost" disabled>Вывод недоступен</button></div><div class="card"><h2>История заявок</h2>'+(rows?'<table><thead><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="muted">Операций пока нет.</p>')+'</div>'));
}

function handleSandboxTopup(res,user,params) {
  if(user.role!=='student'||paymentMode()!=='sandbox') return redirect(res,'/wallet/rub');
  const amount=Number(params.get('amount'));
  if(!Number.isSafeInteger(amount)||amount<1||amount>10000) return redirect(res,'/wallet/rub');
  state.money_operations.push({id:crypto.randomUUID(),user_id:user.id,type:'sandbox_topup_intent',currency:'RUB',amount_rub:amount,status:'sandbox_created',demo:true,real_money_moved:false,created_at:new Date().toISOString()});
  save(); redirect(res,'/wallet/rub');
}

function pageFinancialOperations(res,user) {
  if(user.role!=='admin') return redirect(res,'/');
  const mode=paymentMode();
  const ops=state.money_operations.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100);
  const rows=ops.map(x=>'<tr><td class="small">'+new Date(x.created_at).toLocaleString('ru-RU')+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.user_id||'—')+'</td><td>'+esc(x.amount_rub)+' RUB</td><td>'+esc(x.status)+'</td><td>'+ (x.real_money_moved?'Да':'Нет') +'</td></tr>').join('');
  const banner=mode==='sandbox'?'SANDBOX — тестовые заявки; реальные платежи выключены.':'DISABLED — платёжный модуль не подключён.';
  sendHtml(res,layout('Financial Operations',user,'<h1>Financial Operations</h1><div class="alert alert-info">'+banner+'</div><div class="grid grid-3"><div class="card"><div class="muted small">Операций</div><div class="metric"><div class="value">'+ops.length+'</div></div></div><div class="card"><div class="muted small">Сумма тестовых заявок</div><div class="metric"><div class="value">'+ops.reduce((s,x)=>s+Number(x.amount_rub||0),0).toLocaleString('ru-RU')+' RUB</div></div></div><div class="card"><div class="muted small">Реальные переводы</div><div class="metric"><div class="value">0</div></div></div></div><div class="card"><h2>Журнал операций</h2>'+(rows?'<table><thead><tr><th>Дата</th><th>Тип</th><th>Пользователь</th><th>Сумма</th><th>Статус</th><th>Деньги переведены</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="muted">Операций нет.</p>')+'</div>'));
}

module.exports={pageRubWallet,handleSandboxTopup,pageFinancialOperations,paymentMode};
