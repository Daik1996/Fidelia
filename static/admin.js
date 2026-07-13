/* Fidelia — Panel de administración (vanilla JS) */

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
let CONFIG = null;          // configuración completa del negocio
let CUR = '€';              // símbolo de moneda
let VIEW = 'dashboard';

// Capacidades según el plan contratado (las rellena el backend en /api/config)
const caps = c => !!(CONFIG && CONFIG._caps && CONFIG._caps[c]);
const planLabel = () => (CONFIG && CONFIG._plan_info && CONFIG._plan_info.label) || 'tu plan';
// Plan mínimo que incluye cada capacidad (para el mensaje de "mejora a…")
const CAP_MIN_PLAN = { stats:'Pro', birthday:'Pro', branding:'Pro' };
// Panel "bloqueado" reutilizable. Recibe la CAPACIDAD; si ya se tiene, devuelve '' (no se muestra).
function lockCard(cap, titulo, desc){
  if(caps(cap)) return '';                       // ya desbloqueado (p. ej. Pro o Cadena): nada que bloquear
  const need = CAP_MIN_PLAN[cap] || 'Pro';
  return `<div class="card section-card" style="border:1.5px dashed var(--line);text-align:center;padding:26px 20px;opacity:.95">
    <div style="font-size:32px">🔒</div>
    <h3 style="margin:8px 0 4px">${titulo}</h3>
    <div class="hint" style="max-width:420px;margin:0 auto 12px">${desc}</div>
    <div style="display:inline-block;background:linear-gradient(135deg,#8d4470,#c06a9e);color:#fff;
      font-weight:700;font-size:13px;padding:8px 16px;border-radius:22px">
      Disponible desde el plan ${need} ✨</div>
    <div class="hint" style="margin-top:10px">Habla con tu proveedor de Fidelia para mejorar tu plan.</div>
  </div>`;
}

// Prefijo del restaurante: /r/<slug> (esta página vive en /r/<slug>/admin)
const TBASE = location.pathname.replace(/\/admin\/?$/, '');

// Manifiesto PWA dinámico del restaurante
(function(){ const l=document.createElement('link'); l.rel='manifest';
  l.href = TBASE + '/manifest-admin.webmanifest'; document.head.appendChild(l); })();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/sw.js')
    .then(reg=>{ reg.update();               // buscar SW nuevo cada carga
      if(reg.waiting) reg.waiting.postMessage('skip'); })
    .catch(()=>{}));
}

/* ---------- Instalar como app (acceso directo "Fidelia") ---------- */
let deferredPrompt = null;
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function showInstallBanner(){
  if(isStandalone()) return;
  try{ if(localStorage.getItem('fid_install_off')) return; }catch{}
  document.getElementById('install-banner')?.classList.remove('hide');
}
window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; showInstallBanner(); });
async function installApp(){
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(deferredPrompt){
    document.getElementById('install-banner')?.classList.add('hide');
    deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null;
  }else if(isIOS){
    alert('Para añadir "Fidelia" a tu pantalla de inicio:\n\n1) Toca el botón Compartir (el cuadrado con la flecha ↑) abajo en Safari.\n2) Desliza y elige "Añadir a pantalla de inicio".\n3) Confirma con "Añadir".\n\nQuedará el icono de Fidelia para entrar directo a la gestión.');
  }else{
    alert('Para añadir "Fidelia" a tu pantalla de inicio, abre el menú de tu navegador (⋮) y elige "Añadir a pantalla de inicio" o "Instalar app".');
  }
}
function dismissInstall(){ document.getElementById('install-banner')?.classList.add('hide'); try{localStorage.setItem('fid_install_off','1');}catch{} }
window.addEventListener('load', ()=> setTimeout(showInstallBanner, 1500));

/* ---------- API helper ---------- */
async function api(path, opts={}){
  const res = await fetch(TBASE + path, {
    headers: {'Content-Type':'application/json'},
    credentials:'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if(res.status === 401){ showLogin(); throw new Error('No autenticado'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail || 'Error');
  return data;
}

/* ---------- Toasts ---------- */
function toast(msg, type=''){
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

/* ---------- Modal ---------- */
function modal(html){
  $('#modal-root').innerHTML =
    `<div class="overlay" onclick="if(event.target===this)closeModal()">
       <div class="card modal">${html}</div></div>`;
}
function closeModal(){ $('#modal-root').innerHTML=''; }

/* ---------- Auth ---------- */
async function doLogin(){
  const username = $('#lg-user').value.trim();
  const password = $('#lg-pass').value;
  try{
    await api('/api/auth/login', {method:'POST', body:{username, password}});
    await boot();
  }catch(e){ $('#lg-err').textContent = e.message; }
}
async function doLogout(){ await api('/api/auth/logout',{method:'POST'}); location.reload(); }
function showLogin(){
  setTimeout(()=>{ if(PENDING_CODE){ const f=document.querySelector('#login-card .sub, #login .sub');
    const n=document.createElement('div'); n.style.cssText='margin:10px 0;padding:10px 12px;border-radius:10px;background:#fdf6e8;border:1px solid #ecd9ab;color:#8a6414;font-size:13px;font-weight:600';
    n.textContent='📇 Carné de cliente escaneado ('+PENDING_CODE+'): entra y se cargará solo en Cobro rápido.';
    (f?f.parentElement:document.body).insertBefore(n,(f?f.nextSibling:null)); } },50); $('#app').classList.add('hide'); $('#login').classList.remove('hide'); }

$('#lg-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

/* ---------- Arranque ---------- */
async function boot(){
  CONFIG = await api('/api/config');
  CUR = CONFIG.business.currency_symbol || '€';
  $('#login').classList.add('hide');
  $('#app').classList.remove('hide');
  $$('.nav-item[data-view]').forEach(n=>{
    n.onclick = ()=>{ setView(n.dataset.view); };
  });
  // La pestaña "Mi cadena" solo existe para restaurantes de plan Cadena con grupo asignado
  const showChain = CONFIG._plan==='cadena' && !!CONFIG._chain;
  $('#nav-chain')?.classList.toggle('hide', !showChain);
  if(!CONFIG.setup_done){ showSetupWizard(); return; }
  setView('dashboard');
}

/* ================= ASISTENTE DE CONFIGURACIÓN INICIAL ================= */
function showSetupWizard(){
  $('#modal-root').innerHTML = `
    <div class="overlay" style="background:rgba(35,28,33,.6)">
      <div class="card modal" style="max-width:480px">
        <div class="brand" style="margin-bottom:6px"><div class="brand-mark">F</div><div class="brand-name">Fidelia</div></div>
        <p class="sub" style="margin-bottom:20px">Configura tu negocio en 1 minuto. Podrás cambiarlo todo después.</p>
        <div class="field"><label>Nombre del negocio *</label><input id="sw-name" value="${esc(CONFIG.business.name||'')}" placeholder="Ej. Cafetería Central"></div>
        <div class="field"><label>Eslogan</label><input id="sw-tag" value="${esc(CONFIG.business.tagline||'')}" placeholder="Cada visita suma"></div>
        <div class="form-grid">
          <div class="field"><label>Moneda</label><input id="sw-cur" value="${esc(CONFIG.business.currency_symbol||'€')}"></div>
          <div class="field"><label>Color principal</label><input id="sw-color" type="color" class="swatch" value="${CONFIG.theme.primary||'#6d3b5e'}" style="width:100%;height:40px"></div>
        </div>
        <div class="field"><label>Tipo de negocio (aplica niveles y recompensas sugeridos)</label>
          <select id="sw-tpl">
            <option value="">Mantener los actuales</option>
            <option value="restaurante">Restaurante — ticket 20–40 €</option>
            <option value="cafeteria">Cafetería / Brunch — ticket 5–15 €</option>
            <option value="bar">Bar de tapas — ticket 10–25 €</option>
          </select></div>
        <div class="field"><label>Cambiar contraseña de acceso (opcional)</label>
          <input id="sw-pass" type="password" placeholder="Deja vacío para mantener la actual"></div>
        <button class="btn btn-primary" style="width:100%" onclick="finishSetup()">Empezar a usar Fidelia</button>
        <p id="sw-err" class="sub" style="color:var(--bad);margin-top:10px"></p>
      </div>
    </div>`;
}
async function finishSetup(){
  const name = $('#sw-name').value.trim();
  if(!name){ $('#sw-err').textContent='Pon el nombre de tu negocio.'; return; }
  const body = {business_name:name, tagline:$('#sw-tag').value.trim(),
    currency_symbol:$('#sw-cur').value.trim()||'€', primary:$('#sw-color').value,
    template:$('#sw-tpl')?.value||''};
  const pw = $('#sw-pass').value; if(pw) body.new_password = pw;
  try{
    const r = await api('/api/setup',{method:'POST',body});
    CONFIG = r.config; CUR = CONFIG.business.currency_symbol || '€';
    closeModal(); toast('¡Listo! Bienvenido a Fidelia','ok'); setView('dashboard');
  }catch(e){ $('#sw-err').textContent = e.message; }
}
let PENDING_CODE = null;
try{
  const _qp = new URLSearchParams(location.search);
  if(_qp.get('code')){ PENDING_CODE = _qp.get('code'); history.replaceState(null,'',location.pathname); }
}catch{}
(async ()=>{ try{ await api('/api/auth/me'); await boot(); }catch{ showLogin(); } })();

function setView(v){
  VIEW = v;
  $('#sidebar')?.classList.remove('open');
  $('#nav-backdrop')?.classList.remove('show');
  $$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active', n.dataset.view===v));
  ({dashboard:renderDashboard, customers:renderCustomers, register:renderRegister,
    program:renderProgram, ranking:renderRanking, chain:renderChain, settings:renderSettings}[v] || renderDashboard)();
}

/* ================= DASHBOARD ================= */
async function renderDashboard(){
  const m = $('#main');
  m.innerHTML = `<div class="page-head"><div><h1>Panel</h1>
    <div class="sub">${esc(CONFIG.business.name)}</div></div></div>
    <div id="dash-body"><div class="empty">Cargando…</div></div>`;
  const hasStats = caps('stats');
  const s = hasStats ? await api('/api/stats') : {};
  const dist = s.level_distribution || {};
  const maxDist = Math.max(1, ...Object.values(dist));
  let extras='';
  try{
    const info = await api('/api/info');
    if(info.billing_notice){
      const n=info.billing_notice;
      extras += `<div style="padding:12px 16px;border-radius:12px;margin-bottom:14px;
        background:${n.days_left<0?'#fdf0ee':'#fdf6e8'};border:1px solid ${n.days_left<0?'#f0cfca':'#ecd9ab'};
        color:${n.days_left<0?'var(--bad)':'#8a6414'};font-weight:600;font-size:13.5px">
        ${n.days_left<0?'⚠️ Tu suscripción venció el '+fdate(n.paid_until)+'. Contacta con tu proveedor para renovarla y evitar la suspensión.'
          :'ℹ️ Tu suscripción se renueva el '+fdate(n.paid_until)+' ('+(n.days_left===0?'hoy':'en '+n.days_left+' día'+(n.days_left===1?'':'s'))+').'}</div>`;
    }
    if(caps('birthday')){
      const bd = await api('/api/birthdays');
      if(bd.birthdays.length){
        extras += `<div class="card section-card" style="border-left:4px solid #e56aa2">
          <h3>🎂 Cumpleaños de hoy</h3>
          <div class="hint">¡Felicítales cuando vengan! ${bd.bonus?`El bono de +${bd.bonus} pts se les aplica solo.`:''}</div>
          ${bd.birthdays.map(b=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--line)">
            <span><strong>${esc(b.name)}</strong>${b.phone?` <span class="sub">${esc(b.phone)}</span>`:''}</span>
            <span class="sub">${b.bonus_applied?'✓ bono aplicado':''}</span></div>`).join('')}
        </div>`;
      }
    }
  }catch{}
  const statsBlock = hasStats ? `
    <div class="stat-grid">
      ${stat('Clientes', s.total_customers)}
      ${stat('Nuevos (30 días)', s.new_last_30)}
      ${stat('Visitas totales', s.total_visits)}
      ${stat('Facturado', fmt(s.total_spent)+' '+CUR)}
      ${stat('XP en circulación', s.total_xp)}
      ${stat('Canjes', s.total_redemptions)}
    </div>
    <div class="two-col">
      <div class="card section-card">
        <h3>Clientes por nivel</h3>
        <div class="hint">Distribución actual de tu base de clientes.</div>
        <div class="bars">${Object.entries(dist).map(([k,v])=>`
          <div class="bar-row"><span>${esc(k)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(100*v/maxDist)}%"></div></div>
            <span style="text-align:right">${v}</span></div>`).join('') || '<div class="empty">Sin datos.</div>'}
        </div>
      </div>
      <div class="card section-card">
        <h3>Top clientes</h3>
        <div class="hint">Los que más XP acumulan.</div>
        <table><tbody>${(s.top||[]).map((t,i)=>`
          <tr><td style="width:30px;font-weight:700;color:var(--gold)">${i+1}</td>
          <td>${esc(t.name)}</td><td style="text-align:right;font-weight:600">${t.xp} XP</td></tr>`).join('')
          || '<tr><td class="empty">Aún no hay clientes.</td></tr>'}
        </tbody></table>
      </div>
    </div>`
    : lockCard('stats', 'Estadísticas de tu negocio',
        'Consulta cuántos clientes tienes, cuánto has facturado, tu distribución por niveles y tu top de clientes más fieles.');
  $('#dash-body').innerHTML = extras + `
    <div class="card section-card" style="border-left:4px solid var(--gold)">
      <h3>⚡ Cobro rápido</h3>
      <div class="hint">Teléfono o código del cliente + importe de la cuenta. Nada más.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;flex:1;min-width:170px"><label>Teléfono o código</label>
          <input id="qk-q" placeholder="612345678" onkeydown="if(event.key==='Enter')quickCharge()"></div>
        <div class="field" style="margin:0;width:130px"><label>Importe (${CUR})</label>
          <input id="qk-amt" type="number" step="0.01" placeholder="0.00" onkeydown="if(event.key==='Enter')quickCharge()"></div>
        <label style="display:flex;gap:7px;align-items:center;font-size:13.5px;font-weight:600;color:var(--muted);padding-bottom:9px">
          <input type="checkbox" id="qk-visit" checked style="width:auto"> visita</label>
        <button class="btn btn-primary" style="height:40px" onclick="quickCharge()">Sumar puntos</button>
      </div>
      <div id="qk-out" style="margin-top:10px"></div>
    </div>
    ${statsBlock}`;
  applyPendingCode();
}
const stat=(k,v)=>`<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;

/* ================= MI CADENA (panel unificado multi-local) ================= */
function localAdminUrl(slug){
  const base = TBASE.replace(/\/[^/]+$/, '/' + slug);
  return location.origin + base + '/admin';
}
async function renderChain(){
  const m = $('#main');
  m.innerHTML = `<div class="page-head"><div><h1>Mi cadena</h1>
    <div class="sub">Resumen de todos tus locales juntos</div></div></div>
    <div id="chain-body"><div class="empty">Cargando…</div></div>`;
  let ov;
  try{ ov = await api('/api/chain/overview'); }
  catch(e){ $('#chain-body').innerHTML = `<div class="card section-card"><div class="empty">No se pudo cargar la cadena. ${esc(e.message)}</div></div>`; return; }
  const t = ov.totals, cur = ov.currency || CUR;
  const maxSpent = Math.max(1, ...ov.locals.map(l=>l.spent));
  $('#chain-body').innerHTML = `
    <div class="card section-card" style="border-left:4px solid var(--gold)">
      <h3>👑 ${esc(ov.chain_name)}</h3>
      <div class="hint">${ov.count} local${ov.count===1?'':'es'} en esta cadena. Los datos son la suma de todos.</div>
    </div>
    <div class="stat-grid">
      ${stat('Locales', ov.count)}
      ${stat('Clientes totales', t.customers)}
      ${stat('Nuevos (30 días)', t.new_last_30)}
      ${stat('Visitas totales', t.visits)}
      ${stat('Facturado total', fmt(t.spent)+' '+cur)}
      ${stat('Canjes totales', t.redemptions)}
    </div>
    <div class="card section-card">
      <h3>Comparativa por local</h3>
      <div class="hint">Ordenados por facturación. El tuyo actual va marcado.</div>
      <div style="overflow-x:auto">
      <table class="chain-table" style="width:100%;border-collapse:collapse;margin-top:6px">
        <thead><tr style="text-align:left;border-bottom:2px solid var(--line)">
          <th style="padding:8px 6px">Local</th>
          <th style="padding:8px 6px;text-align:right">Clientes</th>
          <th style="padding:8px 6px;text-align:right">Facturado</th>
          <th style="padding:8px 6px;text-align:right">Visitas</th>
          <th style="padding:8px 6px;text-align:right">Canjes</th>
          <th style="padding:8px 6px"></th>
        </tr></thead>
        <tbody>
        ${ov.locals.map(l=>`<tr style="border-bottom:1px solid var(--line);${l.is_current?'background:rgba(242,182,61,.10)':''}">
          <td style="padding:9px 6px;font-weight:700">${esc(l.name)}${l.is_current?' <span class="sub" style="color:var(--gold)">(este)</span>':''}${l.active?'':' <span class="sub" style="color:var(--bad)">suspendido</span>'}
            <div style="height:5px;background:var(--line);border-radius:4px;margin-top:5px;max-width:220px">
              <div style="height:100%;width:${Math.round(100*l.spent/maxSpent)}%;background:var(--gold);border-radius:4px"></div></div></td>
          <td style="padding:9px 6px;text-align:right">${l.customers}</td>
          <td style="padding:9px 6px;text-align:right;font-weight:700">${fmt(l.spent)} ${cur}</td>
          <td style="padding:9px 6px;text-align:right">${l.visits}</td>
          <td style="padding:9px 6px;text-align:right">${l.redemptions}</td>
          <td style="padding:9px 6px;text-align:right">${l.is_current?'':`<a class="btn btn-ghost btn-sm" style="padding:5px 10px" href="${localAdminUrl(l.slug)}" target="_blank" rel="noopener">Abrir ↗</a>`}</td>
        </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

/* ================= CLIENTES ================= */
let custQuery='';
async function renderCustomers(){
  const m=$('#main');
  m.innerHTML=`<div class="page-head"><div><h1>Clientes</h1>
    <div class="sub">Alta, consulta y gestión de fichas</div></div>
    <button class="btn btn-primary" onclick="customerForm()">＋ Nuevo cliente</button></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <div class="field" style="margin:0;flex:2;min-width:220px">
        <input id="cust-search" placeholder="Buscar por nombre, teléfono, código, apodo o email…" value="${esc(custQuery)}"></div>
      <select id="f-status" style="max-width:150px" onchange="loadCustomers()">
        <option value="all">Todos</option><option value="active">Activos</option>
        <option value="banned">Bloqueados</option></select>
      <select id="f-level" style="max-width:170px" onchange="loadCustomers()">
        <option value="">Todos los niveles</option>
        ${CONFIG.levels.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      <select id="f-sort" style="max-width:170px" onchange="loadCustomers()">
        <option value="xp">Más puntos</option><option value="visits">Más visitas</option>
        <option value="spent">Más gasto</option><option value="redemptions">Más canjes</option>
        <option value="recent">Más recientes</option></select>
    </div>
    <div class="card" id="cust-list"><div class="empty">Cargando…</div></div>`;
  const search=$('#cust-search');
  search.oninput=debounce(()=>{ custQuery=search.value; loadCustomers(); },250);
  loadCustomers();
}
async function loadCustomers(){
  const el=$('#cust-list'); if(!el) return;
  let customers=[], total=0;
  try{
    const st=$('#f-status')?.value||'all', lv=$('#f-level')?.value||'', so=$('#f-sort')?.value||'xp';
    ({customers,total}=await api(`/api/customers?q=${encodeURIComponent(custQuery||'')}&status=${st}&level=${lv}&sort=${so}`));
  }catch(e){ el.innerHTML=`<div class="empty">No se pudo cargar la lista: ${esc(e.message)}. <a href="#" onclick="event.preventDefault();loadCustomers()">Reintentar</a></div>`; return; }
  if(!customers.length){ el.innerHTML='<div class="empty">Sin resultados con estos filtros.</div>'; return; }
  el.innerHTML=`<table><thead><tr><th>Cliente</th><th>Nivel</th><th>Puntos</th><th>Visitas</th><th>Canjes</th><th>Estado</th></tr></thead>
    <tbody>${customers.map(c=>`
      <tr class="row-click" style="${c.active?'':'opacity:.55'}" onclick="customerDetail(${c.id})">
        <td><strong>${esc(c.name)}</strong>${c.nickname?` <span class="sub">«${esc(c.nickname)}»</span>`:''}
          ${c.phone?`<div class="sub">${esc(c.phone)}</div>`:''}</td>
        <td>${c.level?`<span class="badge" style="background:${c.level.color}">${esc(c.level.name)}</span>`:'—'}</td>
        <td style="font-weight:600">${c.xp}</td><td>${c.visits}</td>
        <td>${c.redemptions_count||0}</td>
        <td>${c.active?'<span style="color:var(--ok);font-weight:600">Activo</span>':'<span style="color:var(--bad);font-weight:600">Bloqueado</span>'}</td></tr>`).join('')}
    </tbody></table>
    <div class="sub" style="padding:10px 12px">${total} cliente(s)</div>`;
}
async function editCustomer(id){ const c=await api('/api/customers/'+id); customerForm(c); }
function customerForm(c=null){
  const t=c?'Editar cliente':'Nuevo cliente';
  modal(`<div class="modal-head"><h2>${t}</h2><button class="close" onclick="closeModal()">×</button></div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Nombre *</label><input id="c-name" value="${esc(c?.name||'')}"></div>
      <div class="field"><label>Teléfono</label><input id="c-phone" value="${esc(c?.phone||'')}"></div>
      <div class="field"><label>Email</label><input id="c-email" value="${esc(c?.email||'')}"></div>
      ${caps('birthday')?`<div class="field"><label>Cumpleaños</label><input id="c-bday" type="date" value="${esc(c?.birthday||'')}"></div>`:''}
      <div class="field"><label>Apodo en el ranking <span class="sub">(único en tu local)</span></label>
        <input id="c-nick" maxlength="20" placeholder="Ej. ElDelFondo" value="${esc(c?.nickname||'')}"></div>
      <div class="field" style="grid-column:1/-1"><label>Notas</label><input id="c-notes" value="${esc(c?.notes||'')}"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveCustomer(${c?.id||'null'})">Guardar</button>
    </div>`);
}
async function saveCustomer(id){
  const body={name:$('#c-name').value.trim(), phone:$('#c-phone').value.trim(),
    email:$('#c-email').value.trim(), birthday:($('#c-bday')?.value||''), notes:$('#c-notes').value.trim(),
    nickname:$('#c-nick').value.trim()};
  if(!body.name){ toast('El nombre es obligatorio','bad'); return; }
  try{
    if(id) await api('/api/customers/'+id,{method:'PUT',body});
    else await api('/api/customers',{method:'POST',body});
    closeModal(); toast('Cliente guardado','ok');
    if(VIEW==='customers') loadCustomers(); else customerDetail(id);
  }catch(e){ toast(e.message,'bad'); }
}
async function customerDetail(id){
  const c=await api('/api/customers/'+id);
  const nl=c.next_level;
  modal(`<div class="modal-head"><div>
      <h2>${esc(c.name)}</h2>
      <div class="sub">Código <code class="codebox">${c.code}</code>${c.phone?' · '+esc(c.phone):''}</div>
    </div><button class="close" onclick="closeModal()">×</button></div>
    ${c.active?'':'<div style="padding:10px 14px;background:#fdf0ee;border:1px solid #f0cfca;border-radius:10px;color:var(--bad);font-weight:600;margin-bottom:12px">⛔ Cliente bloqueado: no puede sumar puntos, canjear ni aparecer en el ranking. Su historial se conserva.</div>'}
    <div style="text-align:center;margin-bottom:12px">${qrImg(c.code,120)}
      <div class="sub">Carné del cliente</div></div>

    <div class="stat-grid" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Nivel</div>
        <div class="v" style="font-size:20px;color:${c.level?.color||'#000'}">${esc(c.level?.name||'—')}</div></div>
      <div class="card stat"><div class="k">XP</div><div class="v">${c.xp}</div></div>
      <div class="card stat"><div class="k">Visitas</div><div class="v">${c.visits}</div></div>
      <div class="card stat"><div class="k">Gastado</div><div class="v" style="font-size:20px">${fmt(c.total_spent)} ${CUR}</div></div>
    </div>
    ${nl?`<div class="field"><label>${c.xp_to_next} XP para ${esc(nl.name)}</label>
      <div class="progress"><span style="width:${c.progress_pct||0}%"></span></div></div>`:''}

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">
      <button class="btn btn-gold btn-sm" onclick="closeModal();openEarnFor(${c.id})">＋ Registrar consumo</button>
      <button class="btn btn-ghost btn-sm" onclick="redeemPicker(${c.id})">★ Canjear recompensa</button>
      <button class="btn btn-ghost btn-sm" onclick="adjustForm(${c.id})">± Ajustar XP</button>
      <button class="btn btn-ghost btn-sm" onclick="editCustomer(${c.id})">Editar</button>
      <button class="btn ${c.active?'btn-danger':'btn-ghost'} btn-sm" onclick="banCustomer(${c.id},${c.active?'true':'false'})">${c.active?'⛔ Bloquear':'✓ Desbloquear'}</button>
      <button class="btn btn-danger btn-sm" onclick="delCustomer(${c.id})">Eliminar</button>
    </div>

    <h3 style="font-size:15px;margin:16px 0 8px">Recompensas canjeadas (${(c.redemptions||[]).length})</h3>
    <table><tbody>${(c.redemptions||[]).slice(0,15).map(r=>`
      <tr><td>★ ${esc(r.reward_name)}<div class="sub">${fdate(r.created_at)}</div></td>
        <td style="text-align:right;font-weight:600;color:var(--bad)">−${r.cost_xp} pts</td></tr>`).join('')
      || '<tr><td class="empty">Aún no ha canjeado ninguna recompensa.</td></tr>'}
    </tbody></table>

    <h3 style="font-size:15px;margin:16px 0 8px">Historial</h3>
    <table><tbody>${(c.transactions||[]).slice(0,20).map(t=>`
      <tr><td>${txLabel(t.kind)}${t.note?` · <span class="sub">${esc(t.note)}</span>`:''}
          <div class="sub">${fdate(t.created_at)}</div></td>
        <td style="text-align:right;font-weight:600;color:${t.xp_delta>=0?'var(--ok)':'var(--bad)'}">
          ${t.xp_delta>=0?'+':''}${t.xp_delta} XP</td></tr>`).join('')
      || '<tr><td class="empty">Sin movimientos.</td></tr>'}
    </tbody></table>`);
}
async function banCustomer(id, ban){
  const msg = ban ? '¿Bloquear a este cliente? No podrá sumar puntos, canjear ni salir en el ranking. Sus datos e historial se conservan y puedes desbloquearlo cuando quieras.'
                  : '¿Desbloquear a este cliente? Recuperará el acceso con todos sus puntos.';
  if(!confirm(msg)) return;
  try{
    await api(`/api/customers/${id}/ban`,{method:'POST',body:{banned:ban}});
    toast(ban?'Cliente bloqueado':'Cliente desbloqueado','ok');
    customerDetail(id); loadCustomers();
  }catch(e){ toast(e.message,'bad'); }
}
async function delCustomer(id){
  if(!confirm('¿Eliminar este cliente y todo su historial? Esta acción no se puede deshacer.')) return;
  await api('/api/customers/'+id,{method:'DELETE'});
  closeModal(); toast('Cliente eliminado','ok'); loadCustomers();
}
function adjustForm(id){
  modal(`<div class="modal-head"><h2>Ajustar XP</h2><button class="close" onclick="closeModal()">×</button></div>
    <div class="field"><label>Variación (usa negativo para restar)</label><input id="adj-delta" type="number" value="0"></div>
    <div class="field"><label>Motivo</label><input id="adj-reason" placeholder="Corrección, cortesía…"></div>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="doAdjust(${id})">Aplicar</button></div>`);
}
async function doAdjust(id){
  const delta=parseInt($('#adj-delta').value||'0',10);
  await api('/api/customers/'+id+'/adjust',{method:'POST',body:{delta,reason:$('#adj-reason').value}});
  toast('XP ajustado','ok'); customerDetail(id);
}
async function redeemPicker(id){
  const rewards=CONFIG.rewards.filter(r=>r.active);
  modal(`<div class="modal-head"><h2>Canjear recompensa</h2><button class="close" onclick="closeModal()">×</button></div>
    ${rewards.length?rewards.map(r=>`
      <div class="list-editor"><div class="row" style="grid-template-columns:1fr auto;align-items:center">
        <div><strong>${esc(r.name)}</strong><div class="sub">${esc(r.desc||'')} · ${r.cost_xp} XP${r.min_level?` · nivel ${r.min_level}+`:''}</div></div>
        <button class="btn btn-gold btn-sm" onclick="doRedeem(${id},${r.id})">Canjear</button>
      </div></div>`).join(''):'<div class="empty">No hay recompensas activas. Créalas en Programa.</div>'}`);
}
async function doRedeem(cid,rid){
  try{
    const r=await api('/api/customers/'+cid+'/redeem',{method:'POST',body:{reward_id:rid}});
    toast('Canjeado: '+r.redeemed,'ok'); customerDetail(cid);
  }catch(e){ toast(e.message,'bad'); }
}

/* ================= REGISTRAR CONSUMO ================= */
let selectedCustomer=null;
async function renderRegister(){
  const m=$('#main');
  m.innerHTML=`<div class="page-head"><div><h1>Registrar consumo</h1>
    <div class="sub">Busca al cliente y anota el ticket para sumar XP</div></div></div>
    <div class="card section-card">
      <div class="field"><label>Buscar cliente (nombre, teléfono o código)</label>
        <input id="reg-search" placeholder="Escribe para buscar…" autocomplete="off"></div>
      <div id="reg-results"></div>
      <div id="reg-panel" class="hide"></div>
    </div>`;
  $('#reg-search').oninput=debounce(regSearch,250);
}
async function regSearch(){
  const q=$('#reg-search').value.trim();
  const box=$('#reg-results');
  if(!q){ box.innerHTML=''; return; }
  const {customers}=await api('/api/customers?q='+encodeURIComponent(q)+'&limit=6');
  box.innerHTML=customers.length?`<div class="list-editor">${customers.map(c=>`
    <div class="row row-click" style="grid-template-columns:1fr auto;align-items:center;cursor:pointer" onclick="pickRegById(${c.id})">
      <div><strong>${esc(c.name)}</strong> <span class="pill">${c.code}</span>
        <div class="sub">${c.level?esc(c.level.name):''} · ${c.xp} XP${c.phone?' · '+esc(c.phone):''}</div></div>
      <span class="btn btn-ghost btn-sm">Elegir</span></div>`).join('')}</div>`
    :`<div class="sub" style="padding:8px 0">Sin resultados. <a onclick="customerForm()" style="cursor:pointer">Crear cliente nuevo</a></div>`;
}
async function pickRegById(id){ const c=await api('/api/customers/'+id); pickReg(c); }
function pickReg(c){
  selectedCustomer=c;
  $('#reg-results').innerHTML='';
  $('#reg-search').value=c.name;
  const p=$('#reg-panel'); p.classList.remove('hide');
  const e=CONFIG.earning;
  p.innerHTML=`
    <div class="card" style="padding:16px;margin-top:12px;background:#fdfbfc">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div><strong style="font-size:16px">${esc(c.name)}</strong>
          <div class="sub">${c.level?esc(c.level.name):''} · ${c.xp} XP</div></div>
        <span class="pill">Regla: ${e.xp_per_currency} punto${e.xp_per_currency==1?'':'s'} por ${CUR} · la visita solo cuenta la estadística</span>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field"><label>Importe del ticket (${CUR})</label>
          <input id="reg-amount" type="number" step="0.01" min="0" value="0" oninput="previewXp()"></div>
        <div class="field"><label>Nota (opcional)</label><input id="reg-note" placeholder="Mesa 4, menú del día…"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500;color:var(--ink)">
        <input type="checkbox" id="reg-visit" checked style="width:auto" onchange="previewXp()"> Contar visita (solo estadística, no da puntos)</label>
      <div id="reg-preview" class="pill" style="margin:14px 0">Sumará 0 XP</div><br>
      <button class="btn btn-gold" onclick="submitEarn()">Registrar y sumar XP</button>
    </div>`;
  previewXp();
}
function previewXp(){
  const e=CONFIG.earning;
  const amt=parseFloat($('#reg-amount')?.value||'0')||0;
  let xp=amt*e.xp_per_currency;
  xp=e.round_mode==='floor'?Math.floor(xp):Math.round(xp);
  const el=$('#reg-preview'); if(el) el.textContent='Sumará '+xp+' XP';
}
async function openEarnFor(id){ setView('register'); const c=await api('/api/customers/'+id); pickReg(c); }
async function submitEarn(){
  const body={amount:parseFloat($('#reg-amount').value||'0')||0,
    note:$('#reg-note').value.trim(), count_visit:$('#reg-visit').checked};
  try{
    const r=await api('/api/customers/'+selectedCustomer.id+'/earn',{method:'POST',body});
    toast(`+${r.gained_xp} XP a ${r.name}`,'ok');
    if(r.level_up) toast(`🎉 ¡${r.name} sube a ${r.level_up.name}!`,'ok');
    pickReg(r);
  }catch(e){ toast(e.message,'bad'); }
}

/* ================= PROGRAMA (personalización total) ================= */
let progTab='business';
function renderProgram(){
  const m=$('#main');
  m.innerHTML=`<div class="page-head"><div><h1>Programa</h1>
    <div class="sub">Personaliza todo tu sistema de fidelización</div></div></div>
    <div class="tabs">
      ${['business:Mi negocio','earning:Puntos','levels:Niveles','rewards:Recompensas']
        .map(t=>{const[k,l]=t.split(':');return `<div class="tab ${progTab===k?'active':''}" onclick="progTab='${k}';renderProgram()">${l}</div>`}).join('')}
    </div>
    <div id="prog-body"></div>`;
  if(!['business','earning','levels','rewards'].includes(progTab)) progTab='business';
  ({business:progBusiness,earning:progEarning,levels:progLevels,rewards:progRewards}[progTab])();
}
let _liveTimers={};
function liveSave(section){
  const el=$('#live-'+section)||$('#live-any');
  if(el){ el.textContent='Guardando…'; el.style.color='var(--muted)'; }
  clearTimeout(_liveTimers[section]);
  _liveTimers[section]=setTimeout(async()=>{
    try{
      CONFIG = await api('/api/config',{method:'PUT',body:{[section]:CONFIG[section]}});
      CUR = CONFIG.business.currency_symbol || '€';
      const e2=$('#live-'+section)||$('#live-any');
      if(e2){ e2.textContent='✓ Guardado — tus clientes ya lo ven'; e2.style.color='var(--ok)'; }
    }catch(err){
      const e2=$('#live-'+section)||$('#live-any');
      if(e2){ e2.textContent='✗ '+err.message; e2.style.color='var(--bad)'; }
    }
  },700);
}
function liveBar(section){
  return `<div class="save-bar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span id="live-${section}" class="sub">✎ Edición en vivo: cada cambio se guarda solo y se ve al instante en la vista de tus clientes.</span>
  </div>`;
}
function saveBar(section){
  return `<div class="save-bar"><button class="btn btn-primary" onclick="saveSection('${section}')">Guardar cambios</button></div>`;
}
async function saveSection(section){
  try{
    CONFIG = await api('/api/config',{method:'PUT',body:{[section]:CONFIG[section]}});
    CUR = CONFIG.business.currency_symbol || '€';
    toast('Guardado','ok');
    renderProgram();
  }catch(e){ toast(e.message,'bad'); }
}
function bind(path){ // actualiza CONFIG y guarda solo (en vivo)
  const root = path.split('.')[0];
  return `oninput="setCfg('${path}', this.value);liveSave('${root}')"`;
}
function setCfg(path,val){
  const parts=path.split('.'); let o=CONFIG;
  for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
  const key=parts.at(-1);
  if(typeof o[key]==='number') val=parseFloat(val);
  if(typeof o[key]==='boolean') val=(val===true||val==='true');
  o[key]=val;
}

function progBusiness(){
  const b=CONFIG.business, t=CONFIG.theme, x=CONFIG.texts;
  $('#prog-body').innerHTML=`
    <div class="card section-card">
      <h3>Identidad</h3><div class="hint">Lo que ven tus clientes: nombre, eslogan, moneda y logotipo.</div>
      <div class="form-grid">
        <div class="field"><label>Nombre del negocio</label><input value="${esc(b.name)}" ${bind('business.name')}></div>
        <div class="field"><label>Símbolo de moneda</label><input value="${esc(b.currency_symbol)}" ${bind('business.currency_symbol')}></div>
        <div class="field" style="grid-column:1/-1"><label>Eslogan</label><input value="${esc(b.tagline)}" ${bind('business.tagline')}></div>
      </div>
      ${caps('branding')?`<div class="field"><label>Logotipo</label>
        <div style="display:flex;align-items:center;gap:14px">
          <div id="logo-prev" style="width:56px;height:56px;border-radius:12px;border:1px solid var(--line);background:#fff url('${b.logo_data||''}') center/contain no-repeat;display:grid;place-items:center;color:var(--muted);font-size:11px">${b.logo_data?'':'Logo'}</div>
          <input type="file" accept="image/*" onchange="uploadLogo(this)" style="max-width:280px">
          ${b.logo_data?`<button class="btn btn-ghost btn-sm" onclick="setCfg('business.logo_data','');liveSave('business');progBusiness()">Quitar</button>`:''}
        </div><div class="sub" style="margin-top:6px">PNG o JPG (recomendado &lt; 300 KB).</div>
      </div>`:''}
    </div>
    ${caps('branding')?`<div class="card section-card">
      <h3>Colores y estilo</h3><div class="hint">La app de tus clientes se pinta con estos colores al instante.</div>
      <div class="form-grid">
        <div class="field"><label>Color principal</label>
          <div style="display:flex;gap:8px"><input type="color" class="swatch" value="${t.primary}" oninput="setCfg('theme.primary',this.value);syncHex('p',this.value);liveSave('theme')">
          <input id="hex-p" value="${t.primary}" oninput="setCfg('theme.primary',this.value);liveSave('theme')"></div></div>
        <div class="field"><label>Color de acento (premios/XP)</label>
          <div style="display:flex;gap:8px"><input type="color" class="swatch" value="${t.accent}" oninput="setCfg('theme.accent',this.value);syncHex('a',this.value);liveSave('theme')">
          <input id="hex-a" value="${t.accent}" oninput="setCfg('theme.accent',this.value);liveSave('theme')"></div></div>
        <div class="field"><label>Modo</label><select ${bind('theme.mode')}>
          <option value="light" ${t.mode==='light'?'selected':''}>Claro</option>
          <option value="dark" ${t.mode==='dark'?'selected':''}>Oscuro</option></select></div>
        <div class="field"><label>Tipografía</label><select ${bind('theme.font')}>
          ${['Inter','Poppins','Montserrat','Nunito','Playfair Display'].map(f=>`<option ${t.font===f?'selected':''}>${f}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Vista previa</label>
        <div style="border-radius:12px;overflow:hidden;border:1px solid var(--line)">
          <div style="background:${t.primary};color:#fff;padding:18px;font-family:'Bricolage Grotesque';font-weight:800;font-size:20px">${esc(b.name)}</div>
          <div style="padding:16px;background:#fff"><span class="badge" style="background:${t.accent};color:#3a2600">Recompensa disponible</span></div>
        </div></div>
    </div>`:lockCard('branding', 'Marca propia: logo y colores',
        'Sube tu logotipo y pon los colores y la tipografía de tu marca. Tus clientes verán la app con la identidad de tu negocio en lugar del diseño estándar.')}
    <div class="card section-card">
      <h3>Mensajes</h3><div class="hint">Textos que aparecen en la pantalla de tus clientes.</div>
      <div class="field"><label>Mensaje de bienvenida</label><textarea rows="2" ${bind('texts.welcome')}>${esc(x.welcome)}</textarea></div>
      <div class="form-grid">
        <div class="field"><label>Título del ranking</label><input value="${esc(x.ranking_title)}" ${bind('texts.ranking_title')}></div>
        <div class="field"><label>Ayuda de consulta</label><input value="${esc(x.lookup_help)}" ${bind('texts.lookup_help')}></div>
      </div>
    </div>${liveBar('any')}`;
}
function uploadLogo(input){
  const f=input.files[0]; if(!f) return;
  if(f.size>600*1024){ toast('Imagen muy grande (máx ~600 KB)','bad'); return; }
  const r=new FileReader();
  r.onload=()=>{ setCfg('business.logo_data', r.result); liveSave('business'); progBusiness(); };
  r.readAsDataURL(f);
}
function syncHex(w,v){ const el=$('#hex-'+w); if(el) el.value=v; }

function progEarning(){
  const e=CONFIG.earning, f=CONFIG.features;
  const chk=(k,label,hint)=>`<label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:10px;margin-bottom:10px;font-weight:500;color:var(--ink)">
    <input type="checkbox" ${f[k]?'checked':''} style="width:auto;margin-top:3px" onchange="CONFIG.features['${k}']=this.checked;liveSave('features')">
    <span>${label}<div class="sub" style="font-weight:400">${hint}</div></span></label>`;
  $('#prog-body').innerHTML=`
    <div class="card section-card">
      <h3>Cómo ganan puntos tus clientes</h3>
      <div class="hint">Regla simple: puntos por lo que gastan + un extra por venir. Cámbialo cuando quieras.</div>
      <div class="form-grid">
        <div class="field"><label>Puntos por cada 1 ${CUR} gastado</label><input type="number" step="0.1" value="${e.xp_per_currency}" ${bind('earning.xp_per_currency')}></div>

        <div class="field"><label>Regalo de bienvenida (al darse de alta)</label><input type="number" value="${e.signup_bonus}" ${bind('earning.signup_bonus')}></div>
        <div class="field"><label>Regalo de cumpleaños</label><input type="number" value="${e.birthday_bonus}" ${bind('earning.birthday_bonus')}></div>
        <div class="field"><label>Redondeo</label><select ${bind('earning.round_mode')}>
          <option value="floor" ${e.round_mode==='floor'?'selected':''}>Hacia abajo (recomendado)</option>
          <option value="round" ${e.round_mode==='round'?'selected':''}>Al más cercano</option></select></div>
      </div>
      <div class="pill">Ejemplo real: una cuenta de 25 ${CUR} = <strong>${e.round_mode==='floor'?Math.floor(25*e.xp_per_currency):Math.round(25*e.xp_per_currency)} puntos</strong>. La casilla "visita" solo suma al contador de visitas, no da puntos.</div>
    </div>
    <div class="card section-card">
      <h3>Opciones para tus clientes</h3><div class="hint">Qué pueden ver y hacer desde el QR de mesa.</div>
      ${chk('public_ranking','Ranking público','Tabla con los clientes con más puntos. Motiva la competición sana.')}
      ${chk('self_lookup','Consulta de puntos','Cada cliente puede mirar sus puntos con su teléfono o código.')}
      ${chk('require_phone','Recomendar teléfono en el alta','Facilita encontrar al cliente al cobrar.')}
      <div class="field"><label>Ranking destacado para tus clientes</label>
        <select onchange="CONFIG.features.ranking_period=this.value;liveSave('features')">
          <option value="month" ${!['year','alltime'].includes(f.ranking_period)?'selected':''}>El del mes (recomendado: se renueva el día 1 y motiva a los nuevos)</option>
          <option value="year" ${f.ranking_period==='year'?'selected':''}>El del año (se renueva cada 1 de enero)</option>
          <option value="alltime" ${f.ranking_period==='alltime'?'selected':''}>El histórico (acumulado de siempre)</option>
        </select></div>
      <div class="field"><label>Cómo aparecen los nombres en el ranking</label>
        <select onchange="CONFIG.features.leaderboard_names=this.value;liveSave('features')">
          <option value="nickname" ${f.leaderboard_names==='nickname'?'selected':''}>Apodo elegido por el cliente (recomendado: máxima privacidad)</option>
          <option value="first_initial" ${f.leaderboard_names==='first_initial'?'selected':''}>Nombre + inicial (Ana G.)</option>
          <option value="full" ${f.leaderboard_names==='full'?'selected':''}>Nombre completo</option>
          <option value="anonymized" ${f.leaderboard_names==='anonymized'?'selected':''}>Anónimo (Cliente #1)</option>
        </select>
        <div class="sub" style="margin-top:5px">Con «Apodo», el cliente elige el suyo desde el QR de mesa (o el personal en su ficha); mientras no lo elija, sale como Nombre + inicial. Nunca se muestran teléfonos.</div></div>
    </div>${liveBar('any')}`;
}
function progLevels(){
  const rows=CONFIG.levels.map((lv,i)=>`
    <div class="row lv-row">
      <div><label>Nombre</label><input value="${esc(lv.name)}" oninput="CONFIG.levels[${i}].name=this.value;liveSave('levels')"></div>
      <div><label>XP mínimo</label><input type="number" value="${lv.min_xp}" oninput="CONFIG.levels[${i}].min_xp=parseInt(this.value||0);liveSave('levels')"></div>
      <div><label>Color</label><input type="color" class="swatch" value="${lv.color}" oninput="CONFIG.levels[${i}].color=this.value;liveSave('levels')"></div>
      <div><label>Ventaja</label><input value="${esc(lv.perk||'')}" oninput="CONFIG.levels[${i}].perk=this.value;liveSave('levels')"></div>
      <div><label>&nbsp;</label><button class="btn btn-danger btn-sm" onclick="CONFIG.levels.splice(${i},1);progLevels();liveSave('levels')">✕</button></div>
    </div>`).join('');
  $('#prog-body').innerHTML=`
    <div class="card section-card list-editor">
      <h3>Niveles</h3><div class="hint">Crea los rangos por XP. El cliente sube automáticamente al alcanzar el mínimo.</div>
      ${rows||'<div class="empty">Sin niveles.</div>'}
      <button class="btn btn-ghost btn-sm" onclick="CONFIG.levels.push({name:'Nuevo nivel',min_xp:0,color:'#888',perk:''});progLevels();liveSave('levels')">＋ Añadir nivel</button>
      ${suggestBar('levels')}
    </div>${liveBar('levels')}`;
}
function progRewards(){
  const opts=CONFIG.levels.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const rows=CONFIG.rewards.map((r,i)=>`
    <div class="row rw-row">
      <div><label>Recompensa</label><input value="${esc(r.name)}" oninput="CONFIG.rewards[${i}].name=this.value;liveSave('rewards')"></div>
      <div><label>Coste XP</label><input type="number" value="${r.cost_xp}" oninput="CONFIG.rewards[${i}].cost_xp=parseInt(this.value||0);liveSave('rewards')"></div>
      <div><label>Nivel mín.</label><select oninput="CONFIG.rewards[${i}].min_level=parseInt(this.value)||null;liveSave('rewards')">
        <option value="">Cualquiera</option>${CONFIG.levels.map(l=>`<option value="${l.id}" ${r.min_level==l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div><label>Stock</label><input type="number" value="${r.stock}" oninput="CONFIG.rewards[${i}].stock=parseInt(this.value);liveSave('rewards')"><div class="sub">-1 = ∞</div></div>
      <div><label>Descripción</label><input value="${esc(r.desc||'')}" oninput="CONFIG.rewards[${i}].desc=this.value;liveSave('rewards')"></div>
      <div><label>Activa</label><input type="checkbox" ${r.active?'checked':''} style="width:auto" onchange="CONFIG.rewards[${i}].active=this.checked;liveSave('rewards')">
        <button class="btn btn-danger btn-sm" style="margin-top:4px" onclick="CONFIG.rewards.splice(${i},1);progRewards();liveSave('rewards')">✕</button></div>
    </div>`).join('');
  $('#prog-body').innerHTML=`
    <div class="card section-card list-editor">
      <h3>Recompensas</h3><div class="hint">Catálogo de premios que tus clientes canjean con XP.</div>
      ${rows||'<div class="empty">Sin recompensas.</div>'}
      <button class="btn btn-ghost btn-sm" onclick="CONFIG.rewards.push({id:Date.now()%100000,name:'Nueva recompensa',type:'xp',cost_xp:100,min_level:null,stock:-1,active:true,desc:''});progRewards();liveSave('rewards')">＋ Añadir recompensa</button>
      ${suggestBar('rewards')}
    </div>${liveBar('rewards')}`;
}
function suggestBar(what){
  return `<div style="margin-top:16px;padding:12px;border:1px dashed var(--line);border-radius:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <strong style="font-size:13.5px">Sugerencias:</strong>
    <select id="sug-${what}" style="max-width:260px">
      <option value="restaurante">Restaurante — ticket 20–40 €</option>
      <option value="cafeteria">Cafetería / Brunch — ticket 5–15 €</option>
      <option value="bar">Bar de tapas — ticket 10–25 €</option>
    </select>
    <button class="btn btn-ghost btn-sm" onclick="applyTemplate('${what}')">Aplicar sugerencia</button>
    <span class="sub">Sustituye la lista actual; luego puedes retocarla.</span></div>`;
}
async function applyTemplate(what){
  const key=$('#sug-'+what).value;
  if(!confirm('Esto sustituirá la lista actual de '+(what==='levels'?'niveles':'recompensas')+' por la sugerida. ¿Continuar?')) return;
  try{
    CONFIG = await api('/api/apply_template',{method:'POST',body:{template:key,what}});
    toast('Sugerencia aplicada — tus clientes ya la ven','ok'); renderProgram();
  }catch(e){ toast(e.message,'bad'); }
}

/* ================= RANKING ================= */
async function renderRanking(){
  const m=$('#main');
  m.innerHTML=`<div class="page-head"><div><h1>Ranking</h1>
    <div class="sub">${CONFIG.features.public_ranking?'Público: tus clientes lo ven en su página':'🔒 Privado: solo lo veis tú y el propietario. Actívalo en Programa.'}</div></div>
    <a class="btn btn-ghost" href="${TBASE}/" target="_blank">Abrir vista pública ↗</a></div>
    <div class="card section-card" id="rk"><div class="empty">Cargando…</div></div>`;
  try{
    window._RK = await api('/api/ranking');
    drawAdminRanking(['month','year','alltime'].includes(window._RK.period)?window._RK.period:'month');
  }catch(e){ $('#rk').innerHTML=`<div class="empty">No se pudo cargar el ranking: ${esc(e.message)}</div>`; }
}
function drawAdminRanking(which){
  const R=window._RK, list={month:R.month,year:R.year,alltime:R.alltime}[which]||R.month;
  const tab=(k,l)=>`<div class="tab ${which===k?'active':''}" onclick="drawAdminRanking('${k}')">${l}</div>`;
  const colLabel={month:' del mes',year:' del año',alltime:''}[which];
  const table = list.length?`<table><thead><tr><th>#</th><th>Cliente</th><th>Nivel</th><th style="text-align:right">Puntos${colLabel}</th></tr></thead>
      <tbody>${list.map(r=>`<tr><td style="font-weight:700;color:var(--gold)">${r.rank}</td>
        <td>${esc(r.name)}</td><td>${esc(r.level)}</td><td style="text-align:right;font-weight:600">${r.xp}</td></tr>`).join('')}</tbody></table>`
    :'<div class="empty">Aún no hay puntos en este periodo.</div>';
  const note={month:'Se renueva automáticamente el día 1 de cada mes.',year:'Se renueva automáticamente cada 1 de enero.',alltime:''}[which];
  $('#rk').innerHTML=`<div class="tabs" style="margin-bottom:14px">${tab('month',R.month_label||'Este mes')}${tab('year',R.year_label||'Este año')}${tab('alltime','De siempre')}</div>
    ${table}
    ${note?`<div class="hint" style="margin-top:12px">${note} Los puntos canjeables de los clientes no se tocan.</div>`:''}`;
}

/* ================= AJUSTES ================= */
function printPoster(){
  const b=CONFIG.business, t=CONFIG.theme;
  const url = location.origin + TBASE.replace('/admin','') + '/';
  let qrHtml='';
  try{ const q=qrcode(0,'M'); q.addData(url); q.make(); qrHtml=q.createImgTag(5,0); }catch{ qrHtml='<code>'+url+'</code>'; }
  const card = `
    <div class="poster">
      <div class="head" style="background:${t.primary}">
        ${b.logo_data?`<img class="lg" src="${b.logo_data}">`:''}
        <div class="nm">${esc(b.name)}</div>
      </div>
      <div class="body">
        <div class="big">Escanea y suma puntos</div>
        <div class="qr">${qrHtml}</div>
        <div class="steps">1 · Escanea con la cámara &nbsp;·&nbsp; 2 · Consulta tus puntos<br>3 · Sube de nivel y canjea premios</div>
      </div>
      <div class="foot" style="color:${t.primary}">${esc(b.tagline||'Cada visita suma')}</div>
    </div>`;
  const w=window.open('','_blank','width=850,height=1000');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cartel · ${esc(b.name)}</title><style>
    @page{size:A4;margin:8mm}
    body{font-family:system-ui,sans-serif;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6mm;padding:4mm}
    .poster{border:1.5px dashed #bbb;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;height:128mm}
    .head{color:#fff;padding:8mm 6mm 6mm;text-align:center}
    .lg{width:16mm;height:16mm;object-fit:contain;border-radius:4mm;background:#fff;padding:1.5mm;margin-bottom:2mm}
    .nm{font-size:19px;font-weight:800}
    .body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4mm;text-align:center}
    .big{font-size:16px;font-weight:800;color:#222;margin-bottom:3mm}
    .qr img{width:42mm;height:42mm}
    .steps{font-size:10.5px;color:#666;margin-top:3mm;line-height:1.5}
    .foot{text-align:center;font-weight:700;font-size:12px;padding:0 4mm 5mm}
    </style></head><body>${card}${card}${card}${card}
    <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  w.document.close();
}

async function renderSettings(){
  const m=$('#main');
  m.innerHTML=`<div class="page-head"><div><h1>Ajustes</h1><div class="sub">Dispositivos, datos y seguridad</div></div></div>
    <div class="card section-card" id="devices"><div class="empty">Cargando red…</div></div>
    <div class="card section-card" id="backup"><div class="empty">Cargando datos…</div></div>
    <div class="card section-card" style="max-width:520px">
      <h3>Cambiar contraseña</h3><div class="hint">Protege el acceso al panel.</div>
      <div class="field"><label>Contraseña actual</label><input id="pw-cur" type="password"></div>
      <div class="field"><label>Nueva contraseña</label><input id="pw-new" type="password"></div>
      <button class="btn btn-primary" onclick="changePw()">Actualizar contraseña</button>
    </div>
    <div class="card section-card" style="border-left:4px solid var(--gold)">
      <h3>🖨 Cartel para mesas</h3>
      <div class="hint">Imprime un A4 con 4 carteles recortables con tu QR y tus colores. Ponlos en mesas, barra o caja.</div>
      <button class="btn btn-primary" onclick="printPoster()">Imprimir cartel de mesas</button>
    </div>`;
  loadDevices();
  loadBackupInfo();
}
async function loadBackupInfo(){
  try{
    const info = await api('/api/info');
    const last = info.last_backup ? fdate(info.last_backup) : 'sin copias aún';
    $('#backup').innerHTML = `
      <h3>Tus datos y copias de seguridad</h3>
      <div class="hint">Todos los datos (cuentas, contraseñas cifradas, clientes y puntos) se guardan de forma permanente y no se borran al reiniciar. Se crean copias automáticas cada día.</div>
      <div class="stat-grid" style="margin:6px 0 14px">
        ${stat('Clientes guardados', info.customers)}
        ${stat('Copias conservadas', info.backups_kept)}
      </div>
      <div class="field"><label>Última copia de seguridad</label><input readonly value="${esc(last)}"></div>
      <div class="field"><label>Dónde se guardan tus datos</label>
        <input readonly value="${esc(info.db_path)}" onclick="this.select()"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn-primary" href="${TBASE}/api/export/customers.csv">⭳ Exportar clientes (CSV)</a>
      </div>
      <div class="hint" style="margin-top:12px">Las copias de seguridad completas las gestiona tu proveedor de la plataforma; tus datos se respaldan automáticamente cada día.</div>`;
  }catch(e){ $('#backup').innerHTML = '<div class="empty">No se pudo cargar la información de datos.</div>'; }
}
async function loadDevices(){
  try{
    const net = await api('/api/net');
    const base = `http://${net.lan_ip}:${net.port}${TBASE}`;
    $('#devices').innerHTML = `
      <h3>Conectar dispositivos (misma WiFi)</h3>
      <div class="hint">Las tablets y móviles deben estar en la misma red WiFi que este equipo. Abre estos enlaces en el dispositivo y usa “Añadir a pantalla de inicio” para instalarlo como app.</div>
      <div class="two-col">
        <div style="text-align:center">
          <strong>Tablet del personal</strong>
          <div style="margin:12px 0">${qrImg(base+'/admin',160)}</div>
          <code class="codebox">${base}/admin</code>
        </div>
        <div style="text-align:center">
          <strong>Clientes (cartel/mesa)</strong>
          <div style="margin:12px 0">${qrImg(base+'/',160)}</div>
          <code class="codebox">${base}/</code>
        </div>
      </div>
      <div class="hint" style="margin-top:14px">Para acceso desde fuera del local (nube o Cloudflare Tunnel), consulta el README.</div>`;
  }catch(e){ $('#devices').innerHTML = `<div class="empty">No se pudo obtener la red local.</div>`; }
}
function qrImg(text, sizePx=150){
  try{
    const qr=qrcode(0,'M'); qr.addData(text); qr.make();
    const tag=qr.createImgTag(5,0).replace('<img',`<img style="width:${sizePx}px;height:${sizePx}px;display:block"`);
    return `<div style="display:inline-block;padding:8px;background:#fff;border-radius:10px;border:1px solid var(--line)">${tag}</div>`;
  }catch(e){ return `<div class="sub">${esc(text)}</div>`; }
}
async function changePw(){
  try{
    await api('/api/admin/password',{method:'POST',body:{current_password:$('#pw-cur').value,new_password:$('#pw-new').value}});
    toast('Contraseña actualizada','ok'); $('#pw-cur').value='';$('#pw-new').value='';
  }catch(e){ toast(e.message,'bad'); }
}

/* ---------- utils ---------- */
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function applyPendingCode(){
  if(!PENDING_CODE) return;
  const q=$('#qk-q'); if(!q) return;
  q.value = PENDING_CODE; PENDING_CODE = null;
  quickFind(q.value);
  $('#qk-amt')?.focus();
}
async function quickFind(code){
  const out=$('#qk-out'); if(!out) return;
  try{
    const c = await api('/api/customers/find?q='+encodeURIComponent(code));
    out.innerHTML = `<div style="padding:10px 14px;border-radius:10px;background:#eef7f1;border:1px solid #cfe8d8;color:#1f5d3c;font-weight:600">
      📱 Cliente del QR: <strong>${esc(c.name)}</strong> · ${c.xp} pts · nivel ${esc(c.level?c.level.name:'')}
      — escribe el importe y pulsa «Sumar puntos», o <a href="#" onclick="event.preventDefault();customerDetail(${c.id})">abre su ficha</a>.</div>`;
  }catch(e){ out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function quickCharge(){
  const q=$('#qk-q').value.trim(), amt=parseFloat($('#qk-amt').value)||0;
  const out=$('#qk-out');
  if(!q){ out.innerHTML='<span class="sub" style="color:var(--bad)">Escribe el teléfono o código del cliente.</span>'; return; }
  try{
    const c = await api('/api/customers/find?q='+encodeURIComponent(q));
    await quickEarn(c, amt, out);
  }catch(e){
    // no existe → alta exprés inline
    out.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding:12px;border:1px dashed var(--line);border-radius:10px">
      <span class="sub" style="width:100%">Cliente nuevo · se le dará de alta con el teléfono <strong>${esc(q)}</strong>${CONFIG.earning.signup_bonus?` (+${CONFIG.earning.signup_bonus} pts de bienvenida)`:''}:</span>
      <div class="field" style="margin:0;flex:1;min-width:160px"><label>Nombre</label>
        <input id="qk-name" placeholder="Nombre del cliente" onkeydown="if(event.key==='Enter')quickCreate('${esc(q)}')"></div>
      <button class="btn btn-primary" onclick="quickCreate('${esc(q)}')">Crear y sumar</button>
    </div>`;
    $('#qk-name').focus();
  }
}
async function quickCreate(phone){
  const name=$('#qk-name').value.trim(), amt=parseFloat($('#qk-amt').value)||0, out=$('#qk-out');
  if(!name){ toast('Pon el nombre del cliente','bad'); return; }
  try{
    const c = await api('/api/customers',{method:'POST',body:{name, phone}});
    await quickEarn(c, amt, out, true);
  }catch(e){ out.innerHTML=`<span class="sub" style="color:var(--bad)">✗ ${esc(e.message)}</span>`; }
}
async function quickEarn(c, amt, out, isNew=false){
  let r=c, gained=0;
  if(amt>0 || $('#qk-visit').checked){
    r = await api(`/api/customers/${c.id}/earn`,{method:'POST',body:{amount:amt, count_visit:$('#qk-visit').checked}});
    gained = r.gained_xp||0;
  }
  const lvl = r.level ? `<span class="badge" style="background:${r.level.color};color:#fff">${esc(r.level.name)}</span>` : '';
  out.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px;background:#f2faf5;border:1px solid #cfe9da;border-radius:10px">
    <strong>${isNew?'✓ Alta y cobro:':'✓'} ${esc(r.name)}</strong> ${lvl}
    ${gained?`<span>+${gained} pts</span>`:''}
    <span class="sub">total: <strong>${r.xp} pts</strong>${r.next_level?` · le faltan ${r.xp_to_next} para ${esc(r.next_level.name)}`:''}</span>
    ${r.level_up?`<span class="badge" style="background:var(--gold);color:#3a2600">🎉 ¡Sube a ${esc(r.level_up.name)}!</span>`:''}
    <a href="#" class="sub" style="color:var(--plum);font-weight:600" onclick="event.preventDefault();setView('customers');customerDetail(${r.id})">ver ficha</a>
  </div>`;
  $('#qk-q').value=''; $('#qk-amt').value='';
  $('#qk-q').focus();
}

function fmt(n){ return (Number(n)||0).toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:2}); }
function fdate(iso){ try{return new Date(iso).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return '';} }
function txLabel(k){ return {earn:'Consumo',adjust:'Ajuste',redeem:'Canje',signup:'Alta'}[k]||k; }
function debounce(fn,ms){ let t; return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}; }
