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
})();

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
  try{
    const data = await api('/api/public/lookup',{method:'POST',body:{query:q}});
    window._MYQ = q;
    showCustomer(data);
  }catch(e){
    $('#err').textContent = e.message; $('#err').classList.remove('hide');
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
  // QR con el código del cliente (su carné digital)
  try{
    const qr = qrcode(0, 'M'); qr.addData(c.code); qr.make();
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
    <div class="reward ${r.affordable?'':'locked'}">
      <div><strong>${esc(r.name)}</strong>
        <div class="muted">${esc(r.desc||'')}${r.min_level?` · nivel ${r.min_level}+`:''}</div></div>
      <span class="cost">${r.cost_xp} XP</span>
    </div>`).join('') : '<p class="muted">Aún no hay recompensas disponibles.</p>';
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ---------- PWA: service worker + instalación ---------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); deferredPrompt = e;
  if(!localStorage.getItem('fid_install_off')) $('#install-banner')?.classList.remove('hide');
});
async function installApp(){
  $('#install-banner')?.classList.add('hide');
  if(deferredPrompt){ deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; }
}
function dismissInstall(){ $('#install-banner')?.classList.add('hide'); try{localStorage.setItem('fid_install_off','1');}catch{} }

function reset(){
  $('#mine').classList.add('hide');
  $('#lookup-card').classList.remove('hide');
  $('#q').value=''; $('#err').classList.add('hide');
}

function renderNickBox(nick){
  let box = $('#nick-box');
  if(!box){
    box = document.createElement('div');
    box.id = 'nick-box'; box.className = 'card'; box.style.marginTop = '14px';
    $('#mine').appendChild(box);
  }
  box.innerHTML = `
    <h3 style="margin:0 0 4px">Tu apodo en el ranking</h3>
    <div class="muted" style="font-size:12.5px;margin-bottom:10px">Por privacidad, en el ranking puede aparecer un apodo que elijas tú en lugar de tu nombre. Único en este local.</div>
    <div style="display:flex;gap:8px">
      <input id="nick-in" maxlength="20" placeholder="Ej. ElDelFondo" value="${esc(nick||'')}"
        style="flex:1" onkeydown="if(event.key==='Enter')saveNick()">
      <button class="btn" onclick="saveNick()" style="white-space:nowrap">Guardar</button>
    </div>
    <div id="nick-msg" class="muted" style="font-size:12px;margin-top:8px">${nick?('Ahora mismo apareces como «'+esc(nick)+'».'):''}</div>`;
}
async function saveNick(){
  const msg=$('#nick-msg'), v=$('#nick-in').value.trim();
  if(!v){ msg.textContent='Escribe un apodo (2–20 caracteres).'; msg.style.color='var(--bad,#c0392b)'; return; }
  try{
    const r = await api('/api/public/nickname',{method:'POST',body:{query:window._MYQ, nickname:v}});
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
