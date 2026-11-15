const { balance } = require('../store');
const { esc } = require('../utils/http');
const { unreadCount } = require('../utils/notifications');
const CSS = `
:root{color-scheme:light;--page-bg:#F5F5F0;--surface:#FFF;--surface-soft:#F0F2EC;--text:#202A26;--muted:#77817B;--border:#E2E6DF;--accent:#315F52;--accent-hover:#274D42;--accent-soft:#E8F0EB;--warm:#B8874B;--danger:#A94C48;--shadow:0 8px 26px rgba(28,42,34,.045)}
:root[data-theme="dark"]{color-scheme:dark;--page-bg:#151B18;--surface:#1D2621;--surface-soft:#242F29;--text:#E8EEE9;--muted:#9AA69E;--border:#344139;--accent:#8AB5A2;--accent-hover:#A2C9B8;--accent-soft:#253A30;--warm:#D3AD77;--danger:#E28F88;--shadow:0 8px 26px rgba(0,0,0,.12)}
*{box-sizing:border-box}
html{background:var(--page-bg);scroll-behavior:smooth}
body{margin:0;min-height:100vh;background:var(--page-bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.58;letter-spacing:-.012em;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
button,input,select,textarea{font:inherit}
.container{max-width:1180px;margin:0 auto;padding:0 30px}
.header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--surface) 94%,transparent);border-bottom:1px solid var(--border);backdrop-filter:blur(14px)}
.header-inner{display:flex;align-items:center;gap:28px;min-height:70px}
.logo{display:flex;align-items:center;gap:10px;flex:0 0 auto;color:var(--text);font-weight:750;font-size:19px;letter-spacing:-.055em;text-decoration:none!important}
.coin{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:800}
:root[data-theme="dark"] .coin{color:#17231D}
.nav{display:flex;align-items:center;gap:5px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{display:inline-flex;align-items:center;min-height:38px;padding:7px 10px;border-radius:7px;color:var(--muted);font-size:13px;font-weight:570;white-space:nowrap;text-decoration:none!important;transition:color .16s ease,background .16s ease}
.nav a:hover{color:var(--text);background:var(--surface-soft)}
.header-right{display:flex;align-items:center;gap:10px;flex:0 0 auto}
.header-balance{display:flex;align-items:center;gap:10px;white-space:nowrap;padding:7px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);text-decoration:none!important;font-variant-numeric:tabular-nums}
.header-balance:hover{border-color:var(--accent);text-decoration:none!important}
.header-balance-item{display:flex;align-items:baseline;gap:5px;line-height:1.15}
.header-balance-item small{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.04em}
.header-balance-item b{font-size:12px;font-weight:700}
.header-balance-divider{color:var(--border)}
.notification-link{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--border);border-radius:8px;color:var(--text);background:var(--surface);text-decoration:none!important}
.notification-link:hover{background:var(--surface-soft)}
.notification-link svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.notification-count{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 3px;border-radius:10px;background:var(--danger);color:#fff;font-size:9px;font-weight:750;display:flex;align-items:center;justify-content:center;border:2px solid var(--surface)}
.user-info{display:flex;flex-direction:column;max-width:160px;overflow:hidden;font-size:12px;text-align:right}
.user-info b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:650}
.user-info small{color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
main{padding:34px 0 76px}
h1,h2,h3,p{margin-top:0}
h1{margin-bottom:7px;font-size:clamp(27px,3vw,36px);line-height:1.13;font-weight:680;letter-spacing:-.055em}
h2{margin-bottom:10px;font-size:18px;line-height:1.25;font-weight:660;letter-spacing:-.035em}
h3{margin-bottom:7px;font-size:16px;line-height:1.3;font-weight:650;letter-spacing:-.025em}
p{margin-bottom:0}
.card{margin-bottom:14px;padding:21px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:none}
.card.balance{background:var(--accent-soft);border-color:transparent}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:39px;padding:8px 14px;border:1px solid transparent;border-radius:7px;font-size:13px;font-weight:650;letter-spacing:-.01em;cursor:pointer;text-decoration:none!important;transition:background .16s ease,border-color .16s ease,color .16s ease;font-family:inherit}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover);color:#fff}
:root[data-theme="dark"] .btn-primary{color:#15231C}
.btn-accent{background:var(--warm);color:#fff}
.btn-accent:hover{filter:brightness(.94)}
.btn-ghost{background:transparent;color:var(--text);border-color:var(--border)}
.btn-ghost:hover{background:var(--surface-soft);border-color:var(--muted)}
.btn-danger{background:var(--danger);color:#fff}
.btn-danger:hover{filter:brightness(.92)}
.btn-sm{min-height:32px;padding:5px 10px;font-size:12px}
.btn-block{width:100%;margin-top:8px}
input,select,textarea{display:block;width:100%;min-width:0;margin:5px 0 13px;padding:10px 12px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:7px;font-size:14px;line-height:1.35;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
textarea{min-height:84px;resize:vertical}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
input::placeholder,textarea::placeholder{color:var(--muted);opacity:.8}
label{display:block;margin-bottom:4px;color:var(--text);font-size:12px;font-weight:650}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid transparent;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.025em;white-space:nowrap}
.badge-primary-soft{background:var(--accent-soft);color:var(--accent)}
.badge-accent{background:#F4EEE3;color:#8D6633}
.badge-success{background:#E9F1EA;color:#38654B}
.badge-danger{background:#F5E9E7;color:#9B4945}
.badge-muted{background:var(--surface-soft);color:var(--muted);border-color:var(--border)}
:root[data-theme="dark"] .badge-accent{background:#40372A;color:#E1C08D}
:root[data-theme="dark"] .badge-success{background:#263C30;color:#A7CDB3}
:root[data-theme="dark"] .badge-danger{background:#432C2A;color:#E7A39B}
.muted{color:var(--muted)}
.small{font-size:12px}
.accent{color:var(--warm)}
.row-between{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.grid{display:grid;gap:14px}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(165px,1fr))}
.mt-1{margin-top:8px}.mt-2{margin-top:18px}
.alert{margin-bottom:14px;padding:12px 15px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:7px;background:var(--surface);color:var(--text);font-size:13px}
.alert-info{border-left-color:#6C8C9C;background:var(--surface)}
.alert-danger{border-left-color:var(--danger);background:var(--surface)}
.alert-success{border-left-color:#5E8C6E;background:var(--surface)}
hr{height:1px;margin:17px 0;border:0;background:var(--border)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:11px 10px;text-align:left;border-bottom:1px solid var(--border);vertical-align:middle}
th{color:var(--muted);background:transparent;font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
tbody tr:last-child td{border-bottom:0}
.metric{text-align:left}
.metric .value{margin:5px 0 2px;color:var(--text);font-size:30px;font-weight:680;letter-spacing:-.06em;font-variant-numeric:tabular-nums}
.text-center{text-align:center}
.progress{height:6px;margin-top:9px;overflow:hidden;border-radius:8px;background:var(--surface-soft)}
.progress-bar{height:100%;border-radius:8px;background:var(--accent);transition:width .3s ease}
.theme-toggle{white-space:nowrap}
.home-wallet{padding:25px 27px}
.home-wallet .wallet-primary{font-size:36px;font-weight:720;letter-spacing:-.065em;line-height:1.2;font-variant-numeric:tabular-nums}
.hub-link{display:block;padding:18px 19px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);text-decoration:none!important;transition:border-color .16s ease,transform .16s ease,background .16s ease}
.hub-link:hover{border-color:var(--accent);background:var(--surface-soft);transform:translateY(-1px)}
.hub-link h2{margin:5px 0 4px}
.hub-link .hub-kicker{color:var(--warm);font-size:10px;font-weight:750;letter-spacing:.09em;text-transform:uppercase}
.board-post{padding:21px 23px}
.board-post>p{margin-top:9px;line-height:1.65}
.compose-panel{margin:17px 0;border:1px solid var(--border);border-radius:9px;background:var(--surface)}
.compose-panel>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none;padding:15px 18px}
.compose-panel>summary::-webkit-details-marker{display:none}
.compose-panel>summary:after{content:"+";margin-left:auto;color:var(--accent);font-size:22px;font-weight:400}
.compose-panel[open]>summary:after{content:"−"}
.compose-title{font-size:14px;font-weight:680}
.compose-subtitle{margin-left:8px;color:var(--muted);font-size:12px}
.compose-body{padding:0 13px 3px}
.compose-body>.card{margin-bottom:10px;border:0;border-top:1px solid var(--border);border-radius:0;box-shadow:none}
.help-match{padding:17px 18px}
.help-match>p{margin-top:5px}
.home-list-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);font-size:13px;list-style:none}.home-list-row:last-child{border-bottom:0}.home-list-row a{color:var(--text);font-weight:620}.home-list-row a:hover{color:var(--accent)}.amount-positive{color:#4C8460!important}
.amount-negative{color:var(--danger)!important}
.page-heading{margin-bottom:25px}
.mobile-nav{display:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:1050px){.container{padding-left:22px;padding-right:22px}.header-inner{gap:15px}.user-info{display:none}.nav a{padding-left:8px;padding-right:8px}}
@media(max-width:760px){
 .container{padding-left:15px;padding-right:15px}
 .header-inner{min-height:60px;gap:9px}
 .nav{display:none}
 .header-right{margin-left:auto;gap:6px}
 .header-balance{gap:6px;padding:6px 8px}
 .header-balance-item{gap:3px}
 .header-balance-item b{font-size:11px}
 .header-balance-item small{font-size:8px}
 .notification-link{width:34px;height:34px}
 .theme-toggle{width:34px;min-width:34px;padding:0;font-size:0}
 .theme-toggle:after{content:"◐";font-size:15px}
 main{padding:24px 0 calc(88px + env(safe-area-inset-bottom))}
 h1{font-size:28px}
 .card{padding:16px;border-radius:8px}
 .home-wallet{padding:19px}
 .home-wallet .wallet-primary{font-size:30px}
 .grid-2,.grid-3,.grid-4{grid-template-columns:minmax(0,1fr)}
 .mobile-nav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:50;gap:3px;overflow-x:auto;padding:7px 8px calc(7px + env(safe-area-inset-bottom));background:var(--surface);border-top:1px solid var(--border);box-shadow:0 -6px 24px rgba(15,23,42,.05);-webkit-overflow-scrolling:touch}
 .mobile-nav a{display:flex;align-items:center;justify-content:center;flex:1 0 auto;min-width:66px;min-height:45px;padding:7px 9px;border-radius:6px;color:var(--muted);font-size:11px;font-weight:650;text-align:center;white-space:nowrap}
 .mobile-nav a:hover{background:var(--surface-soft);color:var(--text);text-decoration:none}
 input,select,textarea{font-size:16px}
 table{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
 th,td{white-space:nowrap}
 .row-between{align-items:flex-start}
 .compose-panel>summary{align-items:flex-start;flex-wrap:wrap}
 .compose-subtitle{display:block;width:100%;margin:0}
 .help-match{padding:15px}
}
@media(min-width:761px) and (max-width:1024px){.container{padding-left:18px;padding-right:18px}.grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;


function autoRefreshScript() {
  return `<script>
(function(){
  let last = Date.now();
  ['click','keydown','input','scroll','mousemove'].forEach(ev =>
    document.addEventListener(ev, () => { last = Date.now(); }, { passive: true })
  );
  setInterval(() => {
    if (Date.now() - last > 60000) {
      if (!document.querySelector('input:focus,textarea:focus,select:focus')) {
        location.reload();
      } else { last = Date.now(); }
    }
  }, 10000);
})();
</script>`;
}


function layout(title, user, content) {
  const navItems = !user ? '' : `
    ${user.role === 'student' ? `
      <a href="/app">Главная</a><a href="/board">Доска</a>
      <a href="/activity">Активность</a><a href="/exchange">Биржа</a>
      <a href="/auctions">Аукционы</a>
    ` : ''}
    ${user.role === 'teacher' ? `<a href="/teacher">Кабинет</a><a href="/teacher/impact">Пульс класса</a><a href="/auctions">Аукционы</a>` : ''}
    ${user.role === 'admin' ? `<a href="/admin">Монитор</a><a href="/admin/users">Пользователи</a><a href="/admin/impact">Пульс лицея</a><a href="/admin/market">Курс ScRl</a><a href="/auctions">Аукционы</a><a href="/admin/moderation">Модерация</a><a href="/admin/ai">AI-помощник</a><a href="/admin/financial">Финансы</a>` : ''}
  `;
  const nav = navItems ? `<nav class="nav" aria-label="Основная навигация">${navItems}</nav>` : '';
  const mobileNav = navItems ? `<nav class="mobile-nav" aria-label="Мобильная навигация">${navItems}</nav>` : '';
  const badge = user && user.role === 'student'
    ? `<a class="header-balance" href="/wallet" title="Открыть кошелёк — текущие доступные балансы">
        <span class="header-balance-item"><small>ScRl</small><b>${balance(user.id, 'available').toLocaleString('ru-RU')}</b></span>
        <span class="header-balance-divider">·</span>
        <span class="header-balance-item"><small>V-RUB</small><b>${balance(user.id, 'vrub').toLocaleString('ru-RU')}</b></span>
      </a>` : '';
  const unread = user ? unreadCount(user.id) : 0;
  const notificationLink = user ? `<a class="notification-link" href="/notifications" aria-label="Уведомления${unread ? ', непрочитанных: ' + unread : ''}" title="Уведомления">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
    ${unread ? `<span class="notification-count">${unread > 99 ? '99+' : unread}</span>` : ''}
  </a>` : '';
  const themeToggle = `<button class="btn btn-ghost btn-sm theme-toggle" type="button"
    data-theme-toggle aria-label="Переключить цветовую тему">Тёмная тема</button>`;
  const roleLabel = user ? ({ student: 'Ученик', teacher: 'Учитель', admin: 'Администратор' }[user.role] || user.role) : '';
  const accountInfo = user ? `
    <div class="user-info"><b>${esc(user.full_name)}</b><small>${esc(roleLabel)}</small></div>
    <a href="/logout" class="btn btn-ghost btn-sm">Выйти</a>` : '';
  const right = `<div class="header-right">${badge}${notificationLink}${themeToggle}${accountInfo}</div>`;

  return `<!DOCTYPE html><html lang="ru" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>(function(){try{var t=localStorage.getItem('scrl-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<title>${esc(title)} — ScRl</title><style>${CSS}</style></head>
<body><header class="header"><div class="container header-inner">
<a href="/" class="logo"><span class="coin">S</span>ScRl</a>${nav}${right}
</div></header><main class="container">${content}</main>${mobileNav}${autoRefreshScript()}${themeScript()}</body></html>`;
}

function themeScript() {
  return `<script>
(function(){
  var root = document.documentElement;
  var button = document.querySelector('[data-theme-toggle]');
  function updateButton(){
    if(!button) return;
    var dark = root.dataset.theme === 'dark';
    button.textContent = dark ? '☀ Светлая' : '☾ Тёмная';
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
  }
  updateButton();
  if(button) button.addEventListener('click', function(){
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('scrl-theme', next); } catch(e) {}
    updateButton();
  });
})();
</script>`;
}

module.exports = { CSS, autoRefreshScript, layout, themeScript };
