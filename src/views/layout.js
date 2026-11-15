const { balance } = require('../store');
const { esc } = require('../utils/http');
const { unreadCount } = require('../utils/notifications');
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#FAFAF9;color:#1C1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;min-height:100vh}
a{color:#0F766E;text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:1100px;margin:0 auto;padding:0 20px}
.header{background:#fff;border-bottom:1px solid #E7E5E4;position:sticky;top:0;z-index:10}
.header-inner{display:flex;align-items:center;gap:20px;height:64px;flex-wrap:wrap}
.logo{font-weight:700;color:#0F766E;font-size:20px;display:flex;align-items:center;gap:8px;text-decoration:none!important}
.coin{display:inline-flex;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;font-weight:700;font-size:13px;align-items:center;justify-content:center}
.nav{display:flex;gap:2px;flex:1;flex-wrap:wrap}
.nav a{padding:6px 8px;border-radius:8px;color:#1C1917;font-weight:500;font-size:12px;text-decoration:none!important}
.nav a:hover{background:#CCFBF1}
.header-right{display:flex;align-items:center;gap:12px}
.user-info{display:flex;flex-direction:column;font-size:13px;text-align:right}
.user-info small{color:#78716C;font-size:11px;text-transform:uppercase}
main{padding:24px 0 60px}
h1{font-size:26px;margin-bottom:16px}
h2{font-size:18px;margin-bottom:12px}
h3{font-size:16px}
.card{background:#fff;border:1px solid #E7E5E4;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card.balance{background:#FEF3C7;border-color:#FDE68A}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 16px;border-radius:8px;font-weight:500;font-size:14px;border:none;cursor:pointer;text-decoration:none!important;transition:background .15s;font-family:inherit}
.btn-primary{background:#0F766E;color:#fff}
.btn-primary:hover{background:#115E59}
.btn-accent{background:#F59E0B;color:#fff}
.btn-accent:hover{background:#D97706}
.btn-ghost{background:transparent;color:#1C1917;border:1px solid #E7E5E4}
.btn-ghost:hover{background:#CCFBF1}
.btn-danger{background:#DC2626;color:#fff}
.btn-danger:hover{background:#B91C1C}
.btn-sm{padding:4px 10px;font-size:12px}
.btn-block{width:100%;margin-top:8px}
input,select,textarea{width:100%;padding:8px 12px;border:1px solid #E7E5E4;border-radius:8px;font-family:inherit;font-size:14px;margin-bottom:12px;background:#fff}
input:focus,select:focus,textarea:focus{outline:2px solid #0F766E;outline-offset:-1px;border-color:transparent}
label{display:block;margin-bottom:4px;font-weight:500;font-size:13px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.badge-primary-soft{background:#CCFBF1;color:#0F766E}
.badge-accent{background:#FEF3C7;color:#B45309}
.badge-success{background:#DCFCE7;color:#15803D}
.badge-danger{background:#FEE2E2;color:#B91C1C}
.badge-muted{background:#F5F5F4;color:#78716C}
.muted{color:#78716C}
.small{font-size:12px}
.accent{color:#D97706}
.row-between{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.mt-1{margin-top:8px}.mt-2{margin-top:16px}
.alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
.alert-info{background:#DBEAFE;color:#1E40AF}
.alert-danger{background:#FEE2E2;color:#B91C1C}
.alert-success{background:#DCFCE7;color:#15803D}
hr{border:none;border-top:1px solid #E7E5E4;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px;text-align:left;border-bottom:1px solid #E7E5E4}
th{color:#78716C;font-weight:500;font-size:12px;text-transform:uppercase}
.metric{text-align:center}
.metric .value{font-size:28px;font-weight:700;margin-top:4px}
.text-center{text-align:center}
.progress{height:8px;background:#CCFBF1;border-radius:999px;overflow:hidden;margin-top:8px}
.progress-bar{height:100%;background:#0F766E;transition:width .3s}
@media (max-width:720px){
  .nav{width:100%;order:3;padding-bottom:8px;overflow-x:auto}
  .header-inner{height:auto;padding:10px 0}
  .user-info{display:none}
}

:root {
  color-scheme: light;
  --page-bg: #F4F6F8;
  --surface: #FFFFFF;
  --surface-soft: #F8FAFC;
  --text: #202A35;
  --muted: #687586;
  --border: #E3E8EF;
  --link: #286B71;
  --accent: #286B71;
  --accent-hover: #20585D;
  --focus: #4B8E93;
  --table-head: #F8FAFC;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page-bg: #12191F;
  --surface: #1A242C;
  --surface-soft: #202C35;
  --text: #E8EEF2;
  --muted: #A2AFBA;
  --border: #2D3A44;
  --link: #91C8C5;
  --accent: #78B8B2;
  --accent-hover: #9ACFC9;
  --focus: #8BCAC4;
  --table-head: #202C35;
}
html { background: var(--page-bg); }
body {
  background: var(--page-bg);
  color: var(--text);
  transition: background-color .18s ease, color .18s ease;
}
a { color: var(--link); }
.header { background: var(--surface); border-color: var(--border); }
.logo { color: var(--link); }
.nav a { color: var(--text); }
.nav a:hover { background: var(--surface-soft); }
.user-info small, .muted { color: var(--muted); }
.card { background: var(--surface); border-color: var(--border); box-shadow: 0 1px 2px rgba(15, 23, 42, .035); }
:root[data-theme="dark"] .card { box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.card.balance {
  background: #FFF8E8;
  border-color: #F0E2BE;
}
:root[data-theme="dark"] .card.balance {
  background: #302B20;
  border-color: #514632;
}
.btn-primary { background: var(--accent); color: #FFFFFF; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-ghost { color: var(--text); border-color: var(--border); }
.btn-ghost:hover { background: var(--surface-soft); }
input, select, textarea {
  color: var(--text);
  background: var(--surface);
  border-color: var(--border);
}
input::placeholder, textarea::placeholder { color: var(--muted); opacity: .85; }
input:focus, select:focus, textarea:focus {
  outline-color: var(--focus);
}
.badge-primary-soft { background: #E5F2F1; color: #286B71; }
.badge-muted { background: var(--surface-soft); color: var(--muted); }
:root[data-theme="dark"] .badge-primary-soft { background: #263F42; color: #A7D8D3; }
:root[data-theme="dark"] .badge-accent { background: #403722; color: #E9CA83; }
:root[data-theme="dark"] .badge-success { background: #203B30; color: #9BD6B2; }
:root[data-theme="dark"] .badge-danger { background: #452A2D; color: #F0A6A8; }
.alert-info { background: #EAF1F8; color: #36556F; }
.alert-danger { background: #FCEEEE; color: #9F3439; }
.alert-success { background: #EAF5EE; color: #316B48; }
:root[data-theme="dark"] .alert-info { background: #233545; color: #B6D6EF; }
:root[data-theme="dark"] .alert-danger { background: #432B2F; color: #F1B3B5; }
:root[data-theme="dark"] .alert-success { background: #233B30; color: #B0DEC0; }
hr { border-color: var(--border); }
th, td { border-color: var(--border); }
th { color: var(--muted); background: var(--table-head); }
.progress { background: #DDECE9; }
.progress-bar { background: var(--accent); }
:root[data-theme="dark"] .progress { background: #2A3C3C; }
.metric .value { color: var(--text); }
.theme-toggle { white-space: nowrap; min-height: 36px; }
.mobile-nav { display: none; }
@media (max-width: 760px) {
  .container { padding-left: 14px; padding-right: 14px; }
  .header-inner { min-height: 58px; height: auto; padding: 8px 0; gap: 10px; flex-wrap: nowrap; }
  .logo { flex: 0 0 auto; }
  .nav { display: none; }
  .header-right { margin-left: auto; gap: 7px; flex: 0 1 auto; }
  .header-right .user-info { display: none; }
  .header-right .badge { display: none; }
  .theme-toggle { font-size: 12px; padding: 6px 9px; }
  .mobile-nav {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    gap: 4px;
    overflow-x: auto;
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
    box-shadow: 0 -6px 24px rgba(15, 23, 42, .07);
    -webkit-overflow-scrolling: touch;
  }
  .mobile-nav a {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 0 auto;
    min-width: 72px;
    min-height: 48px;
    padding: 8px 10px;
    border-radius: 10px;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }
  .mobile-nav a:hover { background: var(--surface-soft); text-decoration: none; }
  main { padding-top: 18px; padding-bottom: calc(84px + env(safe-area-inset-bottom)); }
  h1 { font-size: 23px; }
  .card { padding: 16px; border-radius: 11px; }
  .grid-2, .grid-3, .grid-4 { grid-template-columns: minmax(0, 1fr); }
  input, select, textarea { font-size: 16px; }
  table { display: block; max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  th, td { white-space: nowrap; }
  .row-between { align-items: flex-start; }
  .btn { min-height: 38px; }
}
@media (min-width: 761px) and (max-width: 1024px) {
  .container { padding-left: 18px; padding-right: 18px; }
  .header-inner { gap: 12px; }
  .nav a { padding: 6px 7px; font-size: 12px; }
  .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
  }
}

.header-inner{gap:14px;flex-wrap:nowrap;min-height:64px}
.nav{flex-wrap:nowrap;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{font-size:13px;padding:7px 10px;white-space:nowrap}
.header-right{gap:9px;flex-shrink:0}
.header-balance{display:inline-flex;align-items:center;white-space:nowrap;text-decoration:none!important;padding:6px 11px;font-size:12px}
.notification-link{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--border);border-radius:10px;color:var(--text);background:var(--surface);text-decoration:none!important}
.notification-link:hover{background:var(--surface-soft)}
.notification-link svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.notification-count{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#D97757;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid var(--surface)}
.user-info{max-width:190px;overflow:hidden}
.user-info b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card{border-radius:14px}
.btn{border-radius:10px}
@media(max-width:1024px){.user-info{display:none}.nav a{padding:7px 8px;font-size:12px}}
@media(max-width:760px){
 .header-inner{gap:8px;min-height:58px;flex-wrap:nowrap}
 .header-right{gap:6px}
 .header-right .header-balance{display:none}
 .notification-link{width:34px;height:34px}
 .theme-toggle{font-size:11px;padding:6px 8px}
 .logo{font-size:18px}
}
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
    ${user.role === 'teacher' ? `<a href="/teacher">Кабинет</a><a href="/auctions">Аукционы</a>` : ''}
    ${user.role === 'admin' ? `<a href="/admin">Монитор</a><a href="/admin/users">Пользователи</a><a href="/admin/market">Курс ScRl</a><a href="/auctions">Аукционы</a><a href="/admin/moderation">Модерация</a><a href="/admin/ai">AI-помощник</a><a href="/admin/financial">Финансы</a>` : ''}
  `;
  const nav = navItems ? `<nav class="nav" aria-label="Основная навигация">${navItems}</nav>` : '';
  const mobileNav = navItems ? `<nav class="mobile-nav" aria-label="Мобильная навигация">${navItems}</nav>` : '';
  const badge = user && user.role === 'student'
    ? `<a class="badge badge-accent header-balance" href="/wallet" title="Открыть кошелёк">🪙 ${balance(user.id, 'available')} ScRl</a>` : '';
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
