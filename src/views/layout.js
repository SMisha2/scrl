const { balance } = require('../store');
const { esc } = require('../utils/http');
const { unreadCount } = require('../utils/notifications');
const CSS = `
:root{color-scheme:light;--page-bg:#f7f6f1;--surface:#fffefa;--surface-soft:#edf2f5;--text:#35424c;--muted:#77838b;--border:#e3e7e8;--accent:#718fa9;--accent-hover:#5f7f9b;--accent-soft:#e8eff4;--accent-button:#dce7ef;--accent-button-hover:#cfdeea;--accent-button-text:#415b70;--warm:#9b896f;--danger:#b77d78}
:root[data-theme="dark"]{color-scheme:dark;--page-bg:#20282e;--surface:#263139;--surface-soft:#2d3a43;--text:#e7edf0;--muted:#a4b1b8;--border:#3b4850;--accent:#a2bbce;--accent-hover:#bed0dd;--accent-soft:#344651;--accent-button:#3b5363;--accent-button-hover:#466174;--accent-button-text:#f0f4f5;--warm:#c9b79a;--danger:#d7a09a}
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
.card{margin-bottom:16px;padding:12px 0;background:transparent;border:0;border-bottom:1px solid var(--border);border-radius:0;box-shadow:none}
.card.balance{background:transparent;border:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:7px 12px;border:1px solid var(--border);border-radius:3px;font-size:13px;font-weight:550;cursor:pointer;text-decoration:none!important;transition:background .12s ease,border-color .12s ease,color .12s ease;font-family:inherit}
.btn-primary{background:var(--accent-button);border-color:var(--accent-button);color:var(--accent-button-text)}
.btn-primary:hover{background:var(--accent-button-hover);border-color:var(--accent-button-hover);color:var(--accent-button-text)}
.btn-accent{background:var(--accent-soft);border-color:var(--accent-soft);color:var(--accent-hover)}
.btn-accent:hover{background:var(--accent-button);border-color:var(--accent-button);color:var(--accent-button-text)}
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
.card>summary{cursor:pointer;color:var(--accent);font-size:13px;font-weight:600;list-style:none}\n.card>summary::-webkit-details-marker{display:none}\n.card[open]>summary{margin-bottom:12px}
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
.home-greeting{margin-bottom:22px}
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
/* Admin economy: a ledger view built around the circulation balance. */
.economy-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:19px;border-bottom:1px solid var(--border);margin-bottom:27px}
.economy-header h1{margin-bottom:3px;font-size:29px}
.economy-header p{color:var(--muted);font-size:13px}
.economy-updated{color:var(--muted);font-size:11px;white-space:nowrap}
.economy-overview{display:grid;grid-template-columns:minmax(230px,.78fr) minmax(0,1.22fr);gap:48px;align-items:start}
.economy-primary{padding:7px 0 21px;border-bottom:1px solid var(--border)}
.economy-label{display:block;color:var(--muted);font-size:12px}
.economy-primary strong{display:inline-block;margin-top:7px;font-size:43px;line-height:1.05;font-weight:650;letter-spacing:-.055em;font-variant-numeric:tabular-nums}
.economy-unit{margin-left:7px;color:var(--muted);font-size:13px}
.economy-primary p{margin-top:13px;color:var(--muted);font-size:12px}
.economy-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0}
.economy-facts>div{padding:1px 16px 14px 0;border-bottom:1px solid var(--border);margin-bottom:13px}
.economy-facts>div:nth-child(odd){border-right:1px solid var(--border);margin-right:18px}
.economy-facts dt{color:var(--muted);font-size:11px}
.economy-facts dd{margin:4px 0 0;font-size:17px;font-weight:620;font-variant-numeric:tabular-nums}
.economy-activity{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;padding:16px 0;margin:14px 0 19px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.economy-activity>div{display:flex;flex-direction:column;gap:3px}
.economy-activity strong{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums}
.economy-activity span{color:var(--muted);font-size:11px}
.economy-actions{display:flex;flex-wrap:wrap;gap:20px;padding:0 0 18px;border-bottom:1px solid var(--border)}
.economy-actions a{font-size:13px;font-weight:550}
.economy-transactions{margin-top:27px}
.economy-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:15px;margin-bottom:9px}
.economy-section-heading h2{margin:0;font-size:16px}
.economy-section-heading span{color:var(--muted);font-size:11px}
.economy-table{font-size:12px}
.economy-table th{padding:8px 9px}
.economy-table td{padding:10px 9px}
.economy-table td:nth-child(2){font-weight:550;color:var(--text)}
.economy-amount{text-align:right;font-variant-numeric:tabular-nums}
.economy-storage{display:flex;align-items:flex-start;justify-content:space-between;gap:28px;padding-top:15px;margin-top:23px;border-top:1px solid var(--border)}
.economy-storage code{display:block;margin-top:4px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}
.economy-storage>div:last-child{max-width:520px}
.economy-storage strong{font-size:12px;font-weight:600}
.economy-storage p{margin-top:4px;color:var(--muted);font-size:11px;line-height:1.5}
@media(max-width:760px){
 .economy-header{align-items:flex-start;flex-direction:column;gap:6px}
 .economy-overview{grid-template-columns:1fr;gap:20px}
 .economy-primary strong{font-size:38px}
 .economy-activity{gap:12px}
 .economy-activity strong{font-size:19px}
 .economy-activity span{font-size:10px}
 .economy-actions{gap:14px}
 .economy-storage{flex-direction:column;gap:11px}
}


.admin-users-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:20px}
.admin-users-header p{margin-top:5px;color:var(--muted);font-size:13px}
.admin-user-filters{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:0 0 12px;border-bottom:1px solid var(--border)}
.admin-user-filters a{font-size:12px;color:var(--muted)}
.admin-user-filters a:hover{color:var(--text)}
.admin-user-search{display:flex;align-items:center;gap:8px;max-width:620px;margin:16px 0 10px}
.admin-user-search input{margin:0;flex:1}
.admin-user-row{padding:14px 0}
.admin-user-heading{align-items:flex-start;gap:20px}
.admin-user-balance{text-align:right;white-space:nowrap;font-size:13px}
.admin-user-meta{display:flex;align-items:center;gap:12px;margin-top:7px}
.admin-user-actions{margin-top:10px}
.admin-user-actions summary,.admin-delete summary,.admin-user-history summary{cursor:pointer;color:var(--accent);font-size:13px}
.admin-user-actions-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:14px;padding:12px 0 4px}
.admin-user-form{min-width:0;padding:8px 0;border-bottom:1px solid var(--border)}
.admin-user-form form{margin:0}
.admin-user-form input,.admin-user-form select{margin-bottom:8px}
.admin-delete{grid-column:1/-1;padding:8px 0;border-top:1px solid var(--border)}
.admin-delete p{max-width:700px;margin:8px 0 12px}
.admin-delete form{max-width:440px}
.admin-user-history{margin-top:28px;padding-top:14px;border-top:1px solid var(--border)}
.admin-user-history summary{color:var(--muted)}
.admin-user-history table{width:100%;margin-top:12px}
@media(max-width:640px){
  .admin-users-header{align-items:flex-start}
  .admin-user-search{align-items:stretch;flex-wrap:wrap}
  .admin-user-search input{flex-basis:100%}
  .admin-user-heading{flex-direction:column;gap:8px}
  .admin-user-balance{text-align:left}
  .admin-user-filters{gap:12px}
}

/* === ScRl «журнал и доска» === */
:root{
  --page-bg:#f6f4ec;--surface:#fdfcf7;--surface-soft:#eef0e9;
  --text:#2e352f;--muted:#79817a;--border:#e0ded2;
  --accent:#31614b;--accent-hover:#274f3c;--accent-soft:#e4ebe2;
  --accent-button:#31614b;--accent-button-hover:#274f3c;--accent-button-text:#f6f4ec;
  --warm:#a08339;--danger:#a8574d;
}
:root[data-theme="dark"]{
  --page-bg:#212721;--surface:#29302a;--surface-soft:#313a33;
  --text:#e8ebe3;--muted:#a3aca1;--border:#3c453d;
  --accent:#a9c4ad;--accent-hover:#c2d6c5;--accent-soft:#33413a;
  --accent-button:#3c5a49;--accent-button-hover:#476a56;--accent-button-text:#eef2ea;
  --warm:#c8a95e;--danger:#cf9a8f;
}
h1,h2,.logo,.home-section-title{font-family:Georgia,"Times New Roman",serif}
h1{font-weight:700;letter-spacing:-.01em}
h2{font-weight:700;letter-spacing:0}
.logo{font-size:20px;letter-spacing:0}
.logo .coin{font-family:Georgia,serif;font-size:12px}
.header{border-bottom:3px double var(--border)}
th{letter-spacing:.07em}
::selection{background:var(--accent-soft);color:var(--text)}
.board-post>p a,.card p a{text-decoration:underline;text-underline-offset:3px}
:root[data-theme="dark"] .amount-positive{color:#9dc4a9!important}

/* Responsive shell: wide workspace on desktop, compact touch layout on phones. */
html,body{min-height:100%;overflow-x:clip}
body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.header{flex:0 0 auto;position:sticky;top:0;z-index:70}
.container{width:100%;max-width:none;margin-left:auto;margin-right:auto;padding-left:clamp(20px,3vw,58px);padding-right:clamp(20px,3vw,58px)}
.header-inner{min-height:66px;gap:10px 22px;padding-top:8px;padding-bottom:8px;flex-wrap:wrap}
.nav{flex:1 1 560px;flex-wrap:wrap;overflow:visible;gap:2px clamp(10px,1.25vw,20px)}
.nav a{position:relative;display:inline-flex;align-items:center;min-height:40px;padding:0 10px;border:1px solid transparent;border-radius:5px;color:var(--muted);transition:color .16s ease,background .16s ease,border-color .16s ease,transform .16s ease}
.nav a:hover,.nav a:focus-visible{color:var(--text);background:var(--surface-soft);border-color:var(--border);text-decoration:none;transform:translateY(-1px)}
.nav a:active{transform:translateY(0)}
.nav a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.nav a.nav-exchange{color:var(--accent-button-text);background:var(--accent-button);border-color:var(--accent-button);font-weight:700;padding-left:14px;padding-right:14px}
.nav a.nav-exchange:hover,.nav a.nav-exchange:focus-visible{color:var(--accent-button-text);background:var(--accent-button-hover);border-color:var(--accent-button-hover);box-shadow:0 2px 9px rgba(49,97,75,.14)}
.nav a.nav-exchange:after{content:"↗";margin-left:8px;font-size:12px;font-weight:800;line-height:1}
.header-right{margin-left:auto}
main.container{flex:1 0 auto;width:100%;min-height:calc(100vh - 145px);min-height:calc(100dvh - 145px);padding-top:clamp(28px,3vw,46px);padding-bottom:clamp(48px,5vw,76px)}
.site-footer{flex:0 0 auto;padding-top:14px;padding-bottom:22px;border-top:1px solid var(--border);color:var(--muted);font-size:11px}
.mobile-nav-primary{display:contents}
.mobile-more{display:none}
@media(max-width:1100px) and (min-width:761px){
  .container{padding-left:24px;padding-right:24px}
  .header-inner{gap:8px 14px}
  .nav{flex-basis:500px;gap:2px 11px}
  .nav a{font-size:12px}
  .header-balance{gap:6px}
}
@media(max-width:760px){
  html,body{width:100%;overflow-x:clip}
  .container{padding-left:16px;padding-right:16px}
  .header{padding-top:env(safe-area-inset-top)}
  .header-inner{min-height:58px;gap:8px;padding-top:5px;padding-bottom:5px}
  .logo{font-size:19px}
  .header-right{gap:6px}
  .header-balance{gap:5px}
  .header-balance-item{gap:3px}
  .header-balance-item b{font-size:11px}
  .header-balance-item small{font-size:8px}
  .notification-link{width:40px;height:42px}
  .theme-toggle{width:40px;min-width:40px;min-height:40px;padding:0;border:0;font-size:0}
  .theme-toggle:after{content:"◐";font-size:17px}
  .header-right>.btn{min-height:40px;padding:6px 9px}
  main.container{min-height:calc(100dvh - 135px);padding-top:22px;padding-bottom:calc(92px + env(safe-area-inset-bottom))}
  h1{font-size:clamp(25px,7vw,30px);line-height:1.16}
  h2{font-size:18px}
  p{overflow-wrap:anywhere}
  .card{margin-bottom:18px;padding:15px 0}
  .grid{gap:12px}
  .grid-2,.grid-3,.grid-4{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .home-balances{align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
  .home-balance strong{font-size:clamp(20px,6vw,25px)}
  .home-balance-secondary strong{font-size:18px}
  .home-actions{gap:10px 16px;flex-wrap:wrap;margin-bottom:22px}
  .home-actions a{display:inline-flex;align-items:center;min-height:42px}
  .home-sections{grid-template-columns:minmax(0,1fr);gap:24px}
  .board-toolbar{align-items:stretch;gap:8px}
  .board-toolbar form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
  .board-toolbar input{grid-column:1/-1;width:100%;min-width:0}
  .board-toolbar select{width:100%;min-width:0}
  .board-toolbar button,.board-toolbar a{display:inline-flex;justify-content:center;align-items:center;min-height:42px}
  .compose-panel>summary{min-height:48px;gap:8px}
  .compose-subtitle{margin-left:auto;text-align:right}
  .compose-body>.card{max-width:none}
  .board-post{padding:16px 0}
  .board-post .post-meta{flex-wrap:wrap;gap:6px}
  .board-post .post-footer{align-items:stretch!important;flex-direction:column;gap:10px}
  .board-post .post-actions{width:100%;gap:8px 14px}
  .suggestion-row{align-items:stretch;flex-direction:column;gap:8px}
  .suggestion-row .respond-form,.respond-form{width:100%;min-width:0;max-width:none}
  .respond-panel>summary,.report-panel>summary{display:inline-flex;align-items:center;min-height:42px}
  .btn{min-height:44px;padding:9px 14px}
  .btn-sm{min-height:40px;padding:7px 11px;font-size:12px}
  .btn-block{min-height:46px}
  input,select,textarea{min-height:44px;margin:6px 0 14px;padding:10px 12px;font-size:16px}
  textarea{min-height:104px}
  label{font-size:13px}
  .row{gap:8px}
  .row>.btn,.row>form>.btn{flex:1 1 auto}
  .admin-users-header{align-items:flex-start;flex-direction:column;gap:8px}
  .admin-user-search{width:100%;max-width:none;align-items:stretch;flex-wrap:wrap}
  .admin-user-search input{flex-basis:100%}
  .admin-user-heading{align-items:flex-start;flex-direction:column;gap:8px}
  .admin-user-balance{text-align:left}
  .admin-user-filters{gap:8px 14px}
  .economy-overview{grid-template-columns:minmax(0,1fr);gap:18px}
  .economy-activity{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .economy-storage{align-items:stretch;flex-direction:column;gap:12px}
  table{display:block;width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
  th,td{white-space:nowrap}
  .mobile-nav{display:flex;align-items:stretch;position:fixed;left:0;right:0;bottom:0;z-index:90;width:100%;gap:4px;overflow:visible;padding:6px 8px calc(6px + env(safe-area-inset-bottom));background:var(--surface);border-top:1px solid var(--border);box-shadow:0 -3px 16px rgba(30,40,34,.06)}
  .mobile-nav-primary{display:flex;flex:1 1 auto;align-items:stretch;min-width:0;gap:3px}
  .mobile-nav-primary>a,.mobile-more>summary{display:flex;align-items:center;justify-content:center;flex:1 1 0;min-width:0;min-height:48px;padding:6px 3px;color:var(--muted);font-size:11px;font-weight:650;line-height:1.2;text-align:center;white-space:normal;overflow-wrap:anywhere;text-decoration:none!important;cursor:pointer}
  .mobile-nav-primary>a:hover,.mobile-more>summary:hover{color:var(--text)}
  .mobile-nav-primary>a.nav-exchange{color:var(--accent-button-text);background:var(--accent-button);border:1px solid var(--accent-button);font-weight:750}
  .mobile-nav-primary>a.nav-exchange:after{content:"↗";margin-left:4px;font-size:10px;font-weight:800}
  .mobile-nav-primary>a:active{background:var(--surface-soft);border-color:var(--border)}
  .mobile-more{display:block;position:relative;flex:0 0 54px;min-width:54px}
  .mobile-more>summary{width:100%;list-style:none;color:var(--accent)}
  .mobile-more>summary::-webkit-details-marker{display:none}
  .mobile-more-panel{position:absolute;right:0;bottom:calc(100% + 9px);display:grid;gap:0;width:min(300px,calc(100vw - 24px));max-height:min(65dvh,520px);overflow:auto;padding:6px 12px;background:var(--surface);border:1px solid var(--border);overscroll-behavior:contain}
  .mobile-more-panel a{display:flex;align-items:center;min-height:48px;padding:10px 4px;border-bottom:1px solid var(--border);color:var(--text);font-size:14px;font-weight:550;text-decoration:none}
  .mobile-more-panel a:last-child{border-bottom:0}
  .site-footer{padding-bottom:calc(14px + env(safe-area-inset-bottom));font-size:10px}
}
@media(max-width:420px){
  .container{padding-left:13px;padding-right:13px}
  .grid-2,.grid-3,.grid-4{grid-template-columns:minmax(0,1fr)}
  .home-balances{gap:10px}
  .mobile-nav-primary>a,.mobile-more>summary{font-size:10px;padding-left:1px;padding-right:1px}
  .mobile-more{flex-basis:48px;min-width:48px}
  .header-balance-item small{display:none}
  .header-balance{gap:6px}
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
  const navLinks = !user ? [] : ({
    student: [
      { href: '/app', label: 'Главная' },
      { href: '/exchange', label: 'Биржа ScRl', className: 'nav-exchange' },
      { href: '/market', label: 'Услуги' },
      { href: '/board', label: 'Доска помощи' },
      { href: '/orders', label: 'Заказы' },
      { href: '/activity', label: 'Мои дела' },
      { href: '/wallet', label: 'Кошелёк' }
    ],
    teacher: [
      { href: '/teacher', label: 'Кабинет' },
      { href: '/teacher/impact', label: 'Пульс класса' },
      { href: '/auctions', label: 'Аукционы' }
    ],
    admin: [
      { href: '/admin', label: 'Монитор' },
      { href: '/admin/users', label: 'Пользователи' },
      { href: '/admin/market', label: 'Курс ScRl' },
      { href: '/auctions', label: 'Аукционы' },
      { href: '/admin/moderation', label: 'Модерация' },
      { href: '/admin/ai', label: 'AI-помощник' },
      { href: '/admin/financial', label: 'Финансы' }
    ]
  }[user.role] || []);
  const renderNavLink = item => `<a href="${item.href}"${item.className ? ` class="${item.className}"` : ''}>${item.label}</a>`;
  const nav = navLinks.length
    ? `<nav class="nav" aria-label="Основная навигация">${navLinks.map(renderNavLink).join('')}</nav>`
    : '';
  const mobilePrimary = navLinks.length > 4 ? navLinks.slice(0, 4) : navLinks;
  const mobileSecondary = navLinks.length > 4 ? navLinks.slice(4) : [];
  const mobileNav = navLinks.length
    ? `<nav class="mobile-nav" aria-label="Мобильная навигация">
        <div class="mobile-nav-primary">${mobilePrimary.map(renderNavLink).join('')}</div>
        ${mobileSecondary.length ? `<details class="mobile-more">
          <summary aria-label="Открыть остальные разделы">Ещё</summary>
          <div class="mobile-more-panel">${mobileSecondary.map(renderNavLink).join('')}</div>
        </details>` : ''}
      </nav>`
    : '';
  const badge = user && user.role === 'student'
    ? `<a class="header-balance" href="/wallet" title="Открыть кошелёк: доступные балансы">
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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%2331614b'/%3E%3Ctext x='16' y='22' font-family='Georgia,serif' font-size='18' fill='%23f6f4ec' text-anchor='middle'%3ES%3C/text%3E%3C/svg%3E">
<script>(function(){try{var t=localStorage.getItem('scrl-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<title>${esc(title)} · ScRl</title><style>${CSS}</style></head>
<body><header class="header"><div class="container header-inner">
<a href="/" class="logo"><span class="coin">S</span>ScRl</a>${nav}${right}
</div></header><main class="container">${content}</main><footer class="container site-footer">ScRl - проект учеников РЛИ 9кл</footer>${mobileNav}${autoRefreshScript()}${themeScript()}</body></html>`;
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
