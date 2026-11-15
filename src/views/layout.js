const { balance } = require('../store');
const { esc } = require('../utils/http');
const { unreadCount } = require('../utils/notifications');
const CSS = `
:root{color-scheme:light;--page-bg:#fff;--surface:#fff;--surface-soft:#f7f8f5;--text:#252a27;--muted:#777e78;--border:#e6e9e4;--accent:#285b49;--accent-hover:#1e4738;--accent-soft:#edf3ef;--warm:#806441;--danger:#a34843}
:root[data-theme="dark"]{color-scheme:dark;--page-bg:#171a18;--surface:#1d221f;--surface-soft:#242a26;--text:#e7ebe7;--muted:#a0a7a1;--border:#353d37;--accent:#91b5a1;--accent-hover:#a9c8b7;--accent-soft:#25352c;--warm:#d1b48b;--danger:#df9892}
*{box-sizing:border-box}
html{background:var(--page-bg);scroll-behavior:smooth}
body{margin:0;min-height:100vh;background:var(--page-bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:15px;line-height:1.55;letter-spacing:0;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
button,input,select,textarea{font:inherit}
.container{max-width:1040px;margin:0 auto;padding:0 28px}
.header{position:relative;z-index:10;background:var(--surface);border-bottom:1px solid var(--border)}
.header-inner{display:flex;align-items:center;gap:30px;min-height:62px}
.logo{display:flex;align-items:center;gap:8px;flex:0 0 auto;color:var(--text);font-weight:700;font-size:18px;letter-spacing:-.04em;text-decoration:none!important}
.coin{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1.5px solid var(--accent);border-radius:50%;background:transparent;color:var(--accent);font-size:11px;font-weight:700}
.nav{display:flex;align-items:center;gap:22px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{display:inline-flex;align-items:center;min-height:62px;padding:0 1px;border-bottom:2px solid transparent;color:var(--muted);font-size:13px;font-weight:500;white-space:nowrap;text-decoration:none!important}
.nav a:hover{color:var(--text);border-color:var(--text)}
.header-right{display:flex;align-items:center;gap:10px;flex:0 0 auto}
.header-balance{display:flex;align-items:baseline;gap:11px;white-space:nowrap;padding:5px 0;color:var(--text);font-variant-numeric:tabular-nums;text-decoration:none!important}
.header-balance:hover{color:var(--accent)}
.header-balance-item{display:flex;align-items:baseline;gap:4px;line-height:1.1}
.header-balance-item small{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.02em}
.header-balance-item b{font-size:12px;font-weight:650}
.header-balance-divider{color:var(--border)}
.notification-link{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;color:var(--muted);background:transparent;text-decoration:none!important}
.notification-link:hover{color:var(--text)}
.notification-link svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.notification-count{position:absolute;top:-2px;right:-2px;min-width:14px;height:14px;padding:0 3px;border-radius:50%;background:var(--danger);color:#fff;font-size:9px;font-weight:650;display:flex;align-items:center;justify-content:center}
.user-info{display:flex;flex-direction:column;max-width:150px;overflow:hidden;font-size:12px;text-align:right}
.user-info b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}
.user-info small{color:var(--muted);font-size:10px}
main{padding:35px 0 72px}
h1,h2,h3,p{margin-top:0}
h1{margin-bottom:5px;font-size:30px;line-height:1.2;font-weight:650;letter-spacing:-.045em}
h2{margin-bottom:8px;font-size:17px;line-height:1.3;font-weight:650;letter-spacing:-.02em}
h3{margin-bottom:6px;font-size:15px;line-height:1.35;font-weight:650}
p{margin-bottom:0}
.card{margin-bottom:22px;padding:16px 0;background:transparent;border:0;border-bottom:1px solid var(--border);border-radius:0;box-shadow:none}
.card.balance{background:transparent;border:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:7px 12px;border:1px solid var(--border);border-radius:3px;font-size:13px;font-weight:550;cursor:pointer;text-decoration:none!important;transition:background .12s ease,border-color .12s ease,color .12s ease;font-family:inherit}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}
:root[data-theme="dark"] .btn-primary{color:#15221b}
.btn-accent{background:var(--warm);border-color:var(--warm);color:#fff}
.btn-accent:hover{filter:brightness(.94)}
.btn-ghost{background:transparent;color:var(--text);border-color:var(--border)}
.btn-ghost:hover{background:var(--surface-soft);border-color:var(--muted)}
.btn-danger{background:var(--danger);border-color:var(--danger);color:#fff}
.btn-danger:hover{filter:brightness(.92)}
.btn-sm{min-height:29px;padding:4px 9px;font-size:12px}
.btn-block{width:100%;margin-top:8px}
input,select,textarea{display:block;width:100%;min-width:0;margin:5px 0 12px;padding:9px 10px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:3px;font-size:14px;line-height:1.4;outline:none}
textarea{min-height:78px;resize:vertical}
input:focus,select:focus,textarea:focus{border-color:var(--accent);outline:1px solid var(--accent)}
input::placeholder,textarea::placeholder{color:var(--muted);opacity:.8}
label{display:block;margin-bottom:3px;color:var(--muted);font-size:12px;font-weight:550}
.badge{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;border-radius:0;background:transparent;color:var(--muted);font-size:11px;font-weight:550;letter-spacing:0;white-space:nowrap}
.badge-primary-soft{color:var(--accent)}
.badge-accent{color:var(--warm)}
.badge-success{color:#447354}
.badge-danger{color:var(--danger)}
.badge-muted{color:var(--muted)}
:root[data-theme="dark"] .badge-success{color:#9dc4a9}
.muted{color:var(--muted)}
.small{font-size:12px}
.accent{color:var(--warm)}
.row-between{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.grid{display:grid;gap:20px}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.mt-1{margin-top:8px}.mt-2{margin-top:18px}
.alert{margin-bottom:14px;padding:10px 12px;border:0;border-left:2px solid var(--accent);border-radius:0;background:var(--surface-soft);color:var(--text);font-size:13px}
.alert-info{border-left-color:#6c8791;background:var(--surface-soft)}
.alert-danger{border-left-color:var(--danger);background:var(--surface-soft)}
.alert-success{border-left-color:#5d886b;background:var(--surface-soft)}
hr{height:1px;margin:16px 0;border:0;background:var(--border)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 8px;text-align:left;border-bottom:1px solid var(--border);vertical-align:middle}
th{color:var(--muted);background:transparent;font-size:10px;font-weight:650;letter-spacing:.04em;text-transform:uppercase}
tbody tr:last-child td{border-bottom:0}
.metric{text-align:left}
.metric .value{margin:5px 0 2px;color:var(--text);font-size:27px;font-weight:650;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.text-center{text-align:center}
.progress{height:4px;margin-top:8px;overflow:hidden;background:var(--surface-soft)}
.progress-bar{height:100%;background:var(--accent)}
.theme-toggle{white-space:nowrap}
.home-greeting{margin-bottom:28px}
.link-button{display:inline;padding:0;border:0;background:transparent;color:var(--accent);font-size:12px;font-weight:550;cursor:pointer;text-decoration:none}
.link-button:hover{text-decoration:underline;text-underline-offset:3px}
.post-status{margin-left:2px;color:var(--warm);font-size:11px}
.respond-panel,.report-panel{position:relative}
.respond-panel>summary,.report-panel>summary{cursor:pointer;color:var(--accent);font-size:12px;font-weight:550;list-style:none}
.respond-panel>summary::-webkit-details-marker,.report-panel>summary::-webkit-details-marker{display:none}
.respond-form{min-width:min(350px,80vw);max-width:440px;padding:10px 0}
.respond-form input,.respond-form textarea,.respond-form select{margin-bottom:9px}
.respond-form label{margin-top:6px}
.suggestion-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-top:1px solid var(--border)}
.suggestion-row h3{margin:3px 0;font-size:14px}
.suggestion-row .respond-form{min-width:280px}
.board-count{padding-top:12px}
@media(max-width:760px){.suggestion-row{align-items:flex-start;flex-direction:column;gap:8px}.suggestion-row .respond-form{min-width:0;width:100%}.respond-form{min-width:0;width:100%}.post-footer{align-items:flex-start!important;flex-direction:column}.post-actions{width:100%}}

.home-greeting p{margin-top:6px;color:var(--muted);font-size:14px}
.home-balances{display:flex;align-items:flex-end;gap:34px;padding:0 0 21px;border-bottom:1px solid var(--border);margin-bottom:22px}
.home-balance{display:flex;flex-direction:column;gap:1px}
.home-balance small{color:var(--muted);font-size:11px}
.home-balance strong{font-size:25px;font-weight:650;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.home-balance-secondary strong{font-size:19px}
.home-actions{display:flex;align-items:center;gap:22px;margin:0 0 32px}
.home-actions a{font-size:14px;font-weight:600}
.home-sections{display:grid;grid-template-columns:1.2fr .8fr;gap:52px}
.home-section-title{padding-bottom:9px;border-bottom:1px solid var(--border);margin-bottom:0;font-size:13px;font-weight:650}
.home-list{margin:0;padding:0;list-style:none}
.home-list-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);font-size:13px;list-style:none}
.home-list-row:last-child{border-bottom:0}
.home-list-row a{color:var(--text);font-weight:550}
.home-list-row a:hover{color:var(--accent)}
.home-rate{padding-top:20px;border-top:1px solid var(--border);margin-top:28px}
.home-rate strong{font-size:18px;font-weight:650}
.hub-link{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);color:var(--text);text-decoration:none!important}
.hub-link h2{margin:0;font-size:15px}
.hub-link p{margin:2px 0 0;color:var(--muted);font-size:12px}
.hub-link:hover h2{color:var(--accent)}
.hub-kicker{color:var(--muted);font-size:11px;font-weight:550;letter-spacing:0}
.page-heading{margin-bottom:23px}
.board-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:20px 0 10px}
.board-toolbar form{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%}
.board-toolbar input,.board-toolbar select{width:auto;min-width:130px;margin:0}
.board-toolbar input{flex:1;min-width:180px}
.compose-panel{margin:0;border-bottom:1px solid var(--border);background:transparent}
.compose-panel>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:13px 0;color:var(--accent);font-size:13px;font-weight:600}
.compose-panel>summary::-webkit-details-marker{display:none}
.compose-panel>summary:after{content:"+";margin-left:auto;color:var(--muted);font-size:19px;font-weight:400}
.compose-panel[open]>summary:after{content:"−"}
.compose-title{font-size:13px;font-weight:600}
.compose-subtitle{margin-left:0;color:var(--muted);font-size:12px}
.compose-body{padding:12px 0}
.compose-body>.card{max-width:720px}
.board-feed{margin-top:4px}
.board-post{padding:18px 0 19px;border-bottom:1px solid var(--border);margin:0}
.board-post>p{margin-top:8px;line-height:1.6}
.board-post h2{margin:8px 0 5px;font-size:17px}
.board-post .post-meta{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:11px}
.board-post .post-footer{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:12px}
.board-post .post-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.board-post .post-actions form{margin:0}
.help-match{padding:12px 0;border-bottom:1px solid var(--border);margin:0}
.help-match h3{margin:6px 0}
.help-recommendations{padding:17px 0;border-bottom:1px solid var(--border)}
.help-recommendations h2{font-size:14px;margin:0 0 4px}
.help-recommendations>p{font-size:12px;color:var(--muted)}
.amount-positive{color:#477354!important}
.amount-negative{color:var(--danger)!important}
.mobile-nav{display:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:900px){.container{padding-left:20px;padding-right:20px}.header-inner{gap:18px}.nav{gap:14px}.user-info{display:none}}
@media(max-width:760px){
 .container{padding-left:15px;padding-right:15px}
 .header-inner{min-height:56px;gap:8px}
 .nav{display:none}
 .header-right{margin-left:auto;gap:7px}
 .header-balance{gap:6px}
 .header-balance-item{gap:3px}
 .header-balance-item b{font-size:11px}
 .header-balance-item small{font-size:8px}
 .notification-link{width:28px;height:30px}
 .theme-toggle{width:30px;min-width:30px;padding:0;border:0;font-size:0}
 .theme-toggle:after{content:"◐";font-size:15px}
 main{padding:25px 0 calc(85px + env(safe-area-inset-bottom))}
 h1{font-size:26px}
 .grid-2,.grid-3,.grid-4{grid-template-columns:minmax(0,1fr)}
 .home-balances{gap:20px;flex-wrap:wrap;padding-bottom:17px}
 .home-balance strong{font-size:22px}
 .home-balance-secondary strong{font-size:17px}
 .home-actions{gap:17px;flex-wrap:wrap;margin-bottom:24px}
 .home-sections{grid-template-columns:1fr;gap:26px}
 .board-toolbar{align-items:stretch}
 .board-toolbar form{align-items:stretch;display:grid;grid-template-columns:1fr 1fr}
 .board-toolbar input{grid-column:1/-1;width:100%}
 .board-toolbar select{width:100%;min-width:0}
 .compose-panel>summary{align-items:center}
 .compose-subtitle{margin-left:auto}
 .mobile-nav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:50;gap:2px;overflow-x:auto;padding:6px 7px calc(6px + env(safe-area-inset-bottom));background:var(--surface);border-top:1px solid var(--border);-webkit-overflow-scrolling:touch}
 .mobile-nav a{display:flex;align-items:center;justify-content:center;flex:1 0 auto;min-width:60px;min-height:43px;padding:6px 8px;color:var(--muted);font-size:11px;font-weight:600;text-align:center;white-space:nowrap}
 .mobile-nav a:hover{color:var(--text);text-decoration:none}
 input,select,textarea{font-size:16px}
 table{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
 th,td{white-space:nowrap}
}
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
<a href="/" class="logo">ScRl</a>${nav}${right}
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
