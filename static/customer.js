/* Fidelia — Vista pública del cliente */
const $ = s => document.querySelector(s);
let CFG = null;

// Prefijo del restaurante: /r/<slug>
const TBASE = location.pathname.replace(/\/$/, '');

// Manifiesto PWA dinámico del restaurante
(function(){ const l=document.createElement('link'); l.rel='manifest';
  l.href = TBASE + '/manifest.webmanifest'; document.head.appendChild(l); })();

async function api(path, opts={}){
  const res = await fetch(TBASE + path,{headers:{'Content-Type':'application/json'},
    ...opts, body: opts.body?JSON.stringify(opts.body):undefined});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail||'Error');
  return data;
}
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

(async function init(){
  CFG = await api('/api/public/config');
  applyTheme(CFG.theme);
  const b = CFG.business;
  // Cabecera
  $('#logo').innerHTML = b.logo_data
    ? `<img src="${b.logo_data}" alt=""><span class="biz-name">${esc(b.name)}</span>`
    : `<div class="fallback">${esc((b.name||'F')[0])}</div><span class="biz-name">${esc(b.name)}</span>`;
  $('#tagline').textContent = b.tagline || '';
  $('#foot-name').textContent = b.name || '';
  // Banner de campaña de puntos multiplicados (si el negocio la tiene activa)
  if((CFG.active_multiplier||1) > 1){
    const banner = document.createElement('div');
    banner.className = 'promo-banner';
    banner.innerHTML = `🔥 <strong>¡Puntos x${CFG.active_multiplier}${CFG.promo_label?' · '+esc(CFG.promo_label):''}!</strong> Aprovecha y gana el ${CFG.active_multiplier==2?'doble':CFG.active_multiplier+'×'} de puntos.`;
    const host = document.querySelector('.wrap') || document.body;
    host.insertBefore(banner, host.firstChild);
  }
  // Textos
  $('#welcome-title').textContent = b.name || 'Club de fidelidad';
  $('#lookup-help').textContent = CFG.texts.lookup_help || 'Introduce tu teléfono para ver tus puntos.';
  document.title = b.name + ' · Fidelidad';
  // Si la consulta está desactivada, ocultar buscador
  if(!CFG.features.self_lookup){
    $('#lookup-card').innerHTML = `<h2>${esc(b.name)}</h2><p class="muted">${esc(CFG.texts.welcome||'')}</p>`;
  }
  // Ranking
  if(CFG.features.public_ranking) loadRanking();
  // Catálogo público (niveles + premios) visible sin identificarse
  renderCatalog();
  // Enlaces legales en el pie
  loadFootLegal();
  // Si ya se identificó antes en este dispositivo, cargar su ficha automáticamente
  if(CFG.features.self_lookup){
    let saved=null; try{ saved=localStorage.getItem('fid_myq'); }catch{}
    if(saved){
      try{
        const data = await api('/api/public/lookup',{method:'POST',body:{query:saved}});
        window._MYQ = saved;
        showCustomer(data);
      }catch(e){
        const msg=(e&&e.message)||'';
        if(msg==='PIN_REQUIRED'||msg==='PIN_WRONG'){
          // cuenta protegida: precargar el teléfono y pedir el PIN
          $('#q').value = saved;
          $('#pin')?.classList.remove('hide');
          $('#err').textContent='🔒 Escribe tu PIN para entrar.'; $('#err').classList.remove('hide');
          setTimeout(()=>$('#pin')?.focus(),80);
        }else{
          try{ localStorage.removeItem('fid_myq'); }catch{}   // si ya no existe, olvidar
        }
      }
    }
  }
})();

function renderCatalog(){
  const lv=CFG.levels||[], rw=(CFG.rewards||[]);
  if(!lv.length && !rw.length) return;
  $('#cat-levels').innerHTML = lv.map(l=>`
    <div class="rank-row"><span class="rank-n" style="background:${l.color};color:#fff;border-radius:8px">★</span>
      <div><strong>${esc(l.name)}</strong><div class="muted">${esc(l.perk||'')}</div></div>
      <span class="rank-xp">${l.min_xp}+ pts</span></div>`).join('');
  $('#cat-rewards').innerHTML = rw.length ? rw.map(r=>`
    <div class="rank-row"><span class="rank-n" style="background:var(--accent);color:#3a2600;border-radius:8px">🎁</span>
      <div><strong>${esc(r.name)}</strong><div class="muted">${esc(r.desc||'')}</div></div>
      <span class="rank-xp">${r.cost_xp} pts</span></div>`).join('')
    : '<div class="muted">Pronto habrá premios disponibles.</div>';
  $('#catalog-sec').classList.remove('hide');
}

function applyTheme(t){
  const r = document.documentElement.style;
  r.setProperty('--primary', t.primary || '#6d3b5e');
  r.setProperty('--accent', t.accent || '#e0a021');
  if(t.mode === 'dark') document.body.classList.add('dark');
  if(t.font && t.font !== 'Inter'){
    r.setProperty('--font', t.font);
    const l = document.createElement('link'); l.rel='stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${t.font.replace(/ /g,'+')}:wght@400;600;700;800&display=swap`;
    document.head.appendChild(l);
  }
}

$('#q')?.addEventListener('keydown', e=>{ if(e.key==='Enter') lookup(); });

async function lookup(){
  const q = $('#q').value.trim();
  $('#err').classList.add('hide');
  if(!q){ return; }
  const pinEl = $('#pin');
  const body = {query:q};
  if(pinEl && !pinEl.classList.contains('hide') && pinEl.value.trim()) body.pin = pinEl.value.trim();
  try{
    const data = await api('/api/public/lookup',{method:'POST',body});
    window._MYQ = q;
    try{ localStorage.setItem('fid_myq', q); }catch{}
    pinEl?.classList.add('hide'); if(pinEl) pinEl.value='';
    showCustomer(data);
  }catch(e){
    const msg = (e && e.message) || '';
    if(msg==='PIN_REQUIRED'){
      pinEl.classList.remove('hide'); pinEl.focus();
      $('#err').textContent = '🔒 Esta cuenta está protegida. Escribe tu PIN.'; $('#err').classList.remove('hide');
    }else if(msg==='PIN_WRONG'){
      pinEl.classList.remove('hide'); pinEl.value=''; pinEl.focus();
      $('#err').textContent = 'PIN incorrecto. Inténtalo de nuevo.'; $('#err').classList.remove('hide');
    }else{
      $('#err').textContent = msg; $('#err').classList.remove('hide');
    }
  }
}

function showCustomer(data){
  const c = data.customer;
  $('#lookup-card').classList.add('hide');
  $('#mine').classList.remove('hide');
  renderNickBox(c.nickname);
  $('#m-name').textContent = c.name;
  $('#m-xp').textContent = c.xp;
  $('#m-level').textContent = c.level ? c.level.name : '';
  $('#m-code').textContent = c.code;
  // QR carné digital: al escanearlo, abre el panel del restaurante con ESTE cliente ya cargado
  try{
    const qrUrl = location.origin + TBASE + '/admin?code=' + encodeURIComponent(c.code);
    const qr = qrcode(0, 'M'); qr.addData(qrUrl); qr.make();
    $('#m-qr').innerHTML = qr.createImgTag(5, 0);
    const img = $('#m-qr').querySelector('img'); if(img){ img.style.width='170px'; img.style.height='170px'; img.style.display='block'; }
  }catch(e){ $('#m-qr').innerHTML = '<div class="muted">'+esc(c.code)+'</div>'; }
  if(c.next_level){
    $('#m-next').textContent = `${c.xp_to_next} XP para ${c.next_level.name}`;
    $('#m-prog').style.width = (c.progress_pct||0) + '%';
    $('#m-prog-wrap').classList.remove('hide');
  }else{
    $('#m-next').textContent = '¡Nivel máximo alcanzado!';
    $('#m-prog-wrap').classList.add('hide');
  }
  $('#m-rewards').innerHTML = data.rewards.length ? data.rewards.map(r=>`
    <div class="reward ${r.affordable?'afford':'locked'}">
      ${r.affordable?'<div class="ready-badge">✨ ¡Ya es tuyo!</div>':''}
      <div class="reward-row">
        <div class="reward-info">
          <strong>${esc(r.name)}</strong>
          <div class="muted">${esc(r.desc||'')}${r.min_level?` · nivel ${r.min_level}+`:''}</div>
        </div>
        <span class="cost">${r.cost_xp} XP</span>
      </div>
    </div>`).join('') : '<p class="muted">Aún no hay recompensas disponibles.</p>';
  // Seguridad: crear o cambiar el PIN de acceso
  window._HAS_PIN = !!c.has_pin;
  const sec = $('#m-security');
  if(sec){
    sec.innerHTML = c.has_pin
      ? `<span class="muted">🔒 Tu cuenta está protegida con PIN.</span>
         <button class="linkbtn" onclick="pinDialog(true)">Cambiar PIN</button>`
      : `<span class="muted">🔓 Tu cuenta no tiene PIN. Protégela para que nadie más vea tus puntos.</span>
         <button class="linkbtn" onclick="pinDialog(false)">Crear PIN</button>`;
  }
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ---------- PIN de acceso del cliente ---------- */
function pinDialog(hasPin){
  const box = $('#pin-dialog');
  if(!box) return;
  box.classList.remove('hide');
  box.innerHTML = `
    <div class="pin-form">
      <strong>${hasPin?'Cambiar tu PIN':'Crear un PIN de acceso'}</strong>
      <p class="muted" style="margin:4px 0 10px">Un PIN de 4 a 6 números para que solo tú puedas ver tus puntos.</p>
      ${hasPin?`<input id="pin-cur" inputmode="numeric" maxlength="6" placeholder="PIN actual" style="letter-spacing:4px;text-align:center">`:''}
      <input id="pin-new" inputmode="numeric" maxlength="6" placeholder="PIN nuevo (4-6 números)" style="letter-spacing:4px;text-align:center">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" onclick="savePin(${hasPin})">Guardar</button>
        <button class="btn btn-ghost" onclick="$('#pin-dialog').classList.add('hide')">Cancelar</button>
      </div>
      <p class="err hide" id="pin-err"></p>
    </div>`;
  setTimeout(()=>$(hasPin?'#pin-cur':'#pin-new')?.focus(),60);
}
async function savePin(hasPin){
  const err=$('#pin-err'); err.classList.add('hide');
  const nw=($('#pin-new').value||'').replace(/\D/g,'');
  if(nw.length<4||nw.length>6){ err.textContent='El PIN debe tener entre 4 y 6 números.'; err.classList.remove('hide'); return; }
  const body={query: window._MYQ, new_pin: nw};
  if(hasPin) body.current_pin=($('#pin-cur').value||'').replace(/\D/g,'');
  try{
    await api('/api/public/set_pin',{method:'POST',body});
      $('#pin-dialog').classList.add('hide');
      window._HAS_PIN=true;
    const sec=$('#m-security');
    if(sec) sec.innerHTML=`<span class="muted">🔒 Tu cuenta está protegida con PIN.</span>
      <button class="linkbtn" onclick="pinDialog(true)">Cambiar PIN</button>`;
  }catch(e){
    const m=(e&&e.message)||'';
    err.textContent = m==='PIN_WRONG' ? 'El PIN actual no es correcto.' : m;
    err.classList.remove('hide');
  }
}

/* ---------- PWA: service worker + instalación ---------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/sw.js')
    .then(reg=>{ reg.update(); })
    .catch(()=>{}));
}
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); deferredPrompt = e;
  showInstallBanner();
});
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function showInstallBanner(){
  if(isStandalone()) return;                              // ya instalada: no molestar
  if(localStorage.getItem('fid_install_off')) return;    // el usuario la cerró
  $('#install-banner')?.classList.remove('hide');
}
async function installApp(){
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(deferredPrompt){
    // Android/Chrome: instalación nativa en 1 toque
    $('#install-banner')?.classList.add('hide');
    deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null;
  }else if(isIOS){
    // iPhone/iPad: Safari no permite instalación automática -> explicar los pasos
    alert('Para añadir "Fidelia" a tu pantalla de inicio:\n\n1) Toca el botón Compartir (el cuadrado con la flecha ↑) abajo en Safari.\n2) Desliza y elige "Añadir a pantalla de inicio".\n3) Confirma con "Añadir".\n\nQuedará el icono de Fidelia para entrar directo.');
  }else{
    // Otros navegadores: instrucción genérica
    alert('Para añadir "Fidelia" a tu pantalla de inicio, abre el menú de tu navegador (⋮) y elige "Añadir a pantalla de inicio" o "Instalar app".');
  }
}
function dismissInstall(){ $('#install-banner')?.classList.add('hide'); try{localStorage.setItem('fid_install_off','1');}catch{} }
// Mostrar el aviso también cuando NO hay evento nativo (iPhone) tras cargar
window.addEventListener('load', ()=> setTimeout(showInstallBanner, 1500));

function reset(){
  $('#mine').classList.add('hide');
  $('#lookup-card').classList.remove('hide');
  $('#q').value=''; $('#err').classList.add('hide');
}

function forgetMe(){
  try{ localStorage.removeItem('fid_myq'); }catch{}
  window._MYQ = null;
  reset();
}

function renderNickBox(nick){
  let box = $('#nick-box');
  if(!box){
    box = document.createElement('div');
    box.id = 'nick-box'; box.className = 'card'; box.style.marginTop = '14px';
    $('#mine').appendChild(box);
  }
  _nickOrig = nick || '';
  box.innerHTML = `
    <h3 style="margin:0 0 4px">Tu apodo en el ranking</h3>
    <div class="muted" style="font-size:12.5px;margin-bottom:10px">Por privacidad, en el ranking puede aparecer un apodo que elijas tú en lugar de tu nombre. Único en este local.</div>
    <div style="display:flex;gap:8px">
      <input id="nick-in" maxlength="20" placeholder="Ej. ElDelFondo" value="${esc(nick||'')}"
        autocomplete="off" autocapitalize="off" spellcheck="false"
        style="flex:1;min-width:0;background:#ffffff;color:#231c21;-webkit-text-fill-color:#231c21;
          border:1.5px solid #c9bcc4;border-radius:11px;padding:13px 15px;font-size:16px;caret-color:#231c21"
        oninput="checkNick()" onkeydown="if(event.key==='Enter')saveNick()">
      <button class="btn" id="nick-save" onclick="saveNick()" style="white-space:nowrap;width:auto;padding:13px 18px">Guardar</button>
    </div>
    <div id="nick-msg" style="font-size:12.5px;margin-top:8px;min-height:16px;color:var(--muted)">${nick?('Ahora mismo apareces como «'+esc(nick)+'».'):''}</div>`;
}
let _nickTimer=null, _nickOrig='';
function checkNick(){
  const v=$('#nick-in').value.trim(), msg=$('#nick-msg');
  clearTimeout(_nickTimer);
  if(!v){ msg.textContent='Escribe un apodo (2–20 caracteres).'; msg.style.color='var(--muted)'; return; }
  if(v.length<2){ msg.textContent='Un poco más largo (mínimo 2 caracteres).'; msg.style.color='var(--muted)'; return; }
  if(v===_nickOrig){ msg.textContent='Es tu apodo actual.'; msg.style.color='var(--muted)'; return; }
  msg.textContent='Comprobando disponibilidad…'; msg.style.color='var(--muted)';
  _nickTimer=setTimeout(async()=>{
    try{
      const r=await api('/api/public/nickname/check?q='+encodeURIComponent(window._MYQ)+'&nickname='+encodeURIComponent(v));
      if(r.available){ msg.textContent='✓ «'+v+'» está disponible.'; msg.style.color='var(--ok,#2f8f5b)'; }
      else{ msg.textContent='✗ «'+v+'» ya lo usa otra persona. Prueba otro.'; msg.style.color='var(--bad,#c0392b)'; }
    }catch(e){ msg.textContent=''; }
  }, 400);
}
async function saveNick(){
  const msg=$('#nick-msg'), v=$('#nick-in').value.trim();
  if(!v){ msg.textContent='Escribe un apodo (2–20 caracteres).'; msg.style.color='var(--bad,#c0392b)'; return; }
  try{
    const r = await api('/api/public/nickname',{method:'POST',body:{query:window._MYQ, nickname:v}});
    _nickOrig = r.nickname;
    msg.textContent = '✓ Guardado: en el ranking apareces como «'+esc(r.nickname)+'».';
    msg.style.color = 'var(--ok,#2f8f5b)';
    loadRanking();
  }catch(e){ msg.textContent = '✗ '+e.message; msg.style.color='var(--bad,#c0392b)'; }
}

let RANK = null;
async function loadRanking(){
  try{
    RANK = await api('/api/public/ranking');
    if(!RANK.month.length && !RANK.alltime.length) return;
    $('#rank-title').textContent = CFG.texts.ranking_title || 'Ranking';
    $('#ranking-sec').classList.remove('hide');
    drawRanking(['month','year','alltime'].includes(RANK.period)?RANK.period:'month');
  }catch{ /* ranking desactivado */ }
}
function drawRanking(which){
  const list = {month:RANK.month, year:RANK.year, alltime:RANK.alltime}[which] || RANK.month;
  const tab = (k,label)=>`<button onclick="drawRanking('${k}')" style="flex:1;padding:8px 6px;border-radius:9px;border:1px solid var(--line);
    font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;
    background:${which===k?'var(--primary)':'transparent'};color:${which===k?'#fff':'var(--muted)'}">${label}</button>`;
  const empty={month:'Aún no hay puntos este mes. ¡Sé el primero!',year:'Aún no hay puntos este año. ¡Sé el primero!',alltime:'Aún no hay clientes en el ranking.'}[which];
  const rows = list.length ? list.map(r=>`
      <div class="rank-row ${r.rank<=3?'top':''}">
        <span class="rank-n">${r.rank}</span>
        <div><strong>${esc(r.name)}</strong><div class="muted">${esc(r.level)}</div></div>
        <span class="rank-xp">${r.xp} pts</span></div>`).join('')
    : `<div class="muted" style="padding:14px 4px">${empty}</div>`;
  const note={month:'El ranking del mes se renueva el día 1.',year:'El ranking del año se renueva el 1 de enero.',alltime:''}[which];
  $('#rank-list').innerHTML = `
    <div style="display:flex;gap:6px;margin:4px 0 12px">
      ${tab('month','Este mes')}${tab('year',(RANK.year_label||'Este año').replace('Ranking de ','')) }${tab('alltime','De siempre')}
    </div>${rows}
    ${note?`<div class="muted" style="font-size:11.5px;margin-top:10px">${note} Tus puntos para canjear premios no se tocan.</div>`:''}`;
}

/* ---------- Documentos legales (pie de página) ---------- */
async function loadFootLegal(){
  try{
    const docs=(await api('/api/legal')).docs;
    const host=document.getElementById('foot-legal'); if(!host) return;
    host.innerHTML = docs.map(d=>`<a href="#" onclick="event.preventDefault();showLegal('${d.key}')" style="color:var(--muted);margin:0 6px;text-decoration:underline">${esc(d.title)}</a>`).join('');
  }catch{}
}
async function showLegal(key){
  let d; try{ d=await api('/api/legal/'+key); }catch{ return; }
  let ov=document.getElementById('legal-overlay');
  if(!ov){
    ov=document.createElement('div'); ov.id='legal-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML=`<div style="background:#fff;color:#222;max-width:640px;width:100%;max-height:85vh;overflow:auto;border-radius:16px;padding:22px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="margin:0;font-size:20px">${esc(d.title)}</h2>
      <button onclick="document.getElementById('legal-overlay').remove()" style="background:none;border:none;font-size:26px;cursor:pointer;color:#888">×</button>
    </div>
    <div style="font-size:13.5px;line-height:1.6">${legalMd(d.body)}</div></div>`;
}
function legalMd(md){
  const e=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inl=s=>s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/_(.+?)_/g,'<em>$1</em>');
  return e(md).split(/\n\n+/).map(bl=>{
    bl=bl.trim(); if(!bl) return '';
    if(bl.startsWith('### ')) return '<h4>'+inl(bl.slice(4))+'</h4>';
    if(bl.startsWith('## ')) return '<h3>'+inl(bl.slice(3))+'</h3>';
    if(bl.startsWith('# ')) return '<h2 style="margin-top:0">'+inl(bl.slice(2))+'</h2>';
    if(/^\s*-\s/m.test(bl)) return '<ul style="padding-left:20px">'+bl.split(/\n/).filter(l=>l.trim().startsWith('- ')).map(l=>'<li>'+inl(l.replace(/^\s*-\s/,''))+'</li>').join('')+'</ul>';
    return '<p>'+inl(bl).replace(/\n/g,'<br>')+'</p>';
  }).join('');
}
