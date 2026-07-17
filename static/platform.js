/* Fidelia — Panel del propietario de la plataforma */
const $ = s => document.querySelector(s);
let TENANTS = [];

async function api(path, opts={}){
  let res;
  try{
    res = await fetch(path,{headers:{'Content-Type':'application/json'},credentials:'same-origin',
      ...opts, body:opts.body?JSON.stringify(opts.body):undefined});
  }catch{ throw new Error('Sin conexión. Comprueba tu internet e inténtalo de nuevo.'); }
  if(res.status===401){ showLogin(); throw new Error('No autenticado'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail||'Error');
  return data;
}
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg,type=''){ const el=document.createElement('div'); el.className='toast '+type;
  el.textContent=msg; $('#toasts').appendChild(el); setTimeout(()=>el.remove(),3400); }
function modal(html){ $('#modal-root').innerHTML=
  `<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="card modal">${html}</div></div>`; }
function closeModal(){ $('#modal-root').innerHTML=''; }
function showLogin(){ $('#app').classList.add('hide'); $('#login').classList.remove('hide'); }
function qrImg(text,size=150){
  try{ const q=qrcode(0,'M'); q.addData(text); q.make();
    const tag=q.createImgTag(5,0).replace('<img',`<img style="width:${size}px;height:${size}px;display:block"`);
    return `<div style="display:inline-block;padding:8px;background:#fff;border-radius:10px;border:1px solid var(--line)">${tag}</div>`;
  }catch(e){ return `<code class="codebox">${esc(text)}</code>`; }
}

async function doLogin(){
  try{
    await api('/api/platform/login',{method:'POST',body:{username:$('#lg-user').value.trim(),password:$('#lg-pass').value}});
    boot();
  }catch(e){ $('#lg-err').textContent=e.message; }
}
async function doLogout(){ await api('/api/platform/logout',{method:'POST'}); location.reload(); }
$('#lg-pass')?.addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });

async function boot(){
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  loadAll();
}
(async()=>{ try{ await api('/api/platform/me'); boot(); }catch{ showLogin(); } })();

function fmtEUR(n){ return (Math.round((n||0)*100)/100).toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:2}); }
async function loadAll(){
  const [info,{tenants},rev] = await Promise.all([
    api('/api/platform/info'), api('/api/platform/tenants'), api('/api/platform/revenue')]);
  TENANTS = tenants; window._INFO = info; window._REV = rev;
  const unpaid = tenants.filter(t=>t.pay_state==='unpaid').length;
  $('#pstats').innerHTML = `
    <div class="card stat money"><div class="k">💰 Ingresado total</div><div class="v">${fmtEUR(rev.total)} €</div></div>
    <div class="card stat money"><div class="k">📅 Este mes</div><div class="v">${fmtEUR(rev.this_month)} €</div></div>
    <div class="card stat money"><div class="k">🔁 Recurrente (al mes)</div><div class="v">${fmtEUR(rev.mrr)} €</div>
      <div class="sub">${rev.paying_tenants} pagando</div></div>
    <div class="card stat"><div class="k">Negocios</div><div class="v">${info.tenants}</div>
      ${unpaid?`<div class="sub" style="color:var(--bad);font-weight:700">${unpaid} sin pagar</div>`:'<div class="sub" style="color:var(--ok)">todo al día</div>'}</div>
    <div class="card stat"><div class="k">Clientes totales</div><div class="v">${info.customers}</div></div>`;
  drawRevChart(rev.months);
  $('#tcount').textContent = `(${tenants.length})`;
  renderTenants();
}
function drawRevChart(months){
  if(!months || !months.some(m=>m.total>0)){ $('#revchart').innerHTML=''; return; }
  const max = Math.max(...months.map(m=>m.total), 1);
  $('#revchart').innerHTML = `<div class="card" style="padding:16px 18px;margin-top:14px">
    <div class="sub" style="margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase;font-size:10.5px">Ingresos · últimos 6 meses</div>
    <div style="display:flex;gap:10px;align-items:flex-end;height:92px">
      ${months.map(m=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0">
        <div class="sub" style="font-size:11px;color:var(--gold);font-weight:700">${m.total?fmtEUR(m.total)+'€':''}</div>
        <div style="width:100%;max-width:46px;height:${Math.max(3, m.total/max*58)}px;border-radius:6px 6px 2px 2px;
          background:linear-gradient(180deg, var(--gold), #8a6a1e)"></div>
        <div class="sub" style="font-size:10.5px;white-space:nowrap">${m.label}</div></div>`).join('')}
    </div></div>`;
}
function renderTenants(){
  const box=$('#tenants');
  if(!TENANTS.length){ box.innerHTML='<div class="empty">Aún no hay negocios. Crea el primero con «＋ Nuevo negocio».</div>'; return; }
  // Agrupar por cadena (mismo nombre, sin distinguir mayúsculas). Grupos de 2+ locales se enmarcan juntos.
  const ckey = s => (s||'').trim().toLowerCase();
  const groups = new Map();   // clave -> {name, items[]}
  const singles = [];
  for(const t of TENANTS){
    const k = (t.plan==='cadena' && t.chain_group) ? ckey(t.chain_group) : '';
    if(k){ if(!groups.has(k)) groups.set(k,{name:t.chain_group,items:[]}); groups.get(k).items.push(t); }
    else singles.push(t);
  }
  const chunks=[];
  // Primero las cadenas (con 2+ locales van en marco; con 1 local se tratan como suelto)
  for(const {name,items} of groups.values()){
    if(items.length>=2){
      const tot=items.reduce((a,t)=>({cust:a.cust+(t.customers||0),rev:a.rev+(t.revenue_total||0)}),{cust:0,rev:0});
      chunks.push(`<div class="chain-wrap">
        <div class="chain-head">
          <div class="chain-title">👑 ${esc(name)} <span class="chain-count">${items.length} locales</span></div>
          <div class="chain-tot">${tot.cust} clientes · <span style="color:var(--gold)">${fmtEUR(tot.rev)} €</span> facturado</div>
        </div>
        <div class="chain-grid">${items.map(tenantCard).join('')}</div>
      </div>`);
    } else { singles.push(items[0]); }
  }
  // Luego los locales sueltos, en la rejilla normal
  if(singles.length) chunks.push(`<div class="tgrid-inner">${singles.map(tenantCard).join('')}</div>`);
  box.innerHTML = chunks.join('');
}
function tenantCard(t){
  const pl=t.plan_info||{label:'Pro',color:'#8d4470',color2:'#c06a9e',emoji:'⭐',price:69};
  return `
    <div class="card tcard pay-${t.pay_state}" style="border-left:5px solid ${pl.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="min-width:0">
          <div class="name" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="width:13px;height:13px;border-radius:4px;background:${t.primary};flex:none"></span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span>
            <span class="plan-badge" style="background:linear-gradient(135deg,${pl.color},${pl.color2});" title="Plan ${esc(pl.label)} · ${fmtEUR(pl.price)} €/mes">${pl.emoji} ${esc(pl.label)}</span></div>
          <div class="sub" style="margin-top:3px">/r/${t.slug}${t.setup_done?'':' · <strong style="color:var(--gold)">sin configurar</strong>'}${t.active?'':' · <strong style="color:var(--bad)">suspendido</strong>'}</div>
          <div style="margin-top:8px">${payChip(t)}</div>
          <div class="sub" style="margin-top:6px"><span style="color:var(--ink);font-weight:700">${fmtEUR(t.price)} €/mes</span>
            · me ha dado <span style="color:var(--gold);font-weight:700">${fmtEUR(t.revenue_total)} €</span></div>
        ${t.location?`<div class="sub" style="margin-top:3px"><a href="https://maps.google.com/?q=${encodeURIComponent(t.location)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--plum-700);text-decoration:none" title="Ver en el mapa">📍 ${esc(t.location)} ↗</a></div>`:''}
          ${t.notes?`<div class="sub" style="margin-top:7px;color:var(--ink);background:rgba(255,255,255,.06);
            border:1px solid var(--line);border-radius:8px;padding:6px 10px;white-space:pre-wrap;word-break:break-word">📝 ${esc(t.notes)}</div>`:''}
        </div>
        <div style="text-align:right;flex:none">
          <div class="bignum">${t.customers}<small>clientes</small></div>
          <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end">
            ${t.location?`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.location)}"
              target="_blank" rel="noopener" title="Ver en el mapa: ${esc(t.location)}"
              style="width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;
              background:rgba(255,255,255,.05);text-decoration:none;font-size:16px">📍</a>`:''}
            <button class="btn btn-ghost btn-sm" style="width:32px;height:32px;padding:0;font-size:14px"
              title="Notas y ubicación" onclick="notesForm(${t.id})">📝</button>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">
        <button class="btn btn-primary btn-sm" style="flex:1" onclick="handoff(${t.id})">Entregar</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="billingForm(${t.id})">Cobro</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="tenantCustomers(${t.id})">Clientes</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="editForm(${t.id})">Gestionar</button>
      </div>
    </div>`;
}
function payChip(t){
  if(t.pay_state==='paid') return `<span class="pay-pill paid">
    <span class="pay-dot"></span> Pagado${t.billing.paid_until?' · activo hasta '+fdate(t.billing.paid_until):''}</span>`;
  if(t.pay_state==='unpaid') return `<span class="pay-pill unpaid">
    <span class="pay-dot"></span> Sin pagar${t.billing.paid_until?' · venció '+fdate(t.billing.paid_until):''}</span>`;
  return `<span class="pay-pill none"><span class="pay-dot"></span> Sin cobro configurado</span>`;
}

/* ---------- Notas y ubicación del restaurante (solo para mí) ---------- */
function notesForm(tid){
  const t = TENANTS.find(x=>x.id===tid); if(!t) return;
  modal(`<div class="modal-head"><div><h2>Notas de ${esc(t.name)}</h2>
      <div class="sub">Privadas: solo las ves tú en este panel.</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div class="field"><label>Notas (teléfono, contacto, recordatorios…)</label>
      <textarea id="nf-notes" rows="4" style="width:100%;padding:9px 11px;border:1px solid var(--line);
        border-radius:9px;background:#332536;color:var(--ink);font-family:inherit;font-size:14px;resize:vertical"
        placeholder="Ej. Dueño: Manolo · 612 345 678&#10;Cerrado los lunes">${esc(t.notes||'')}</textarea></div>
    <div class="field"><label>Ubicación (dirección para el mapa 📍)</label>
      <input id="nf-loc" value="${esc(t.location||'')}" placeholder="Ej. Calle Mayor 12, Alcorcón, Madrid"></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-primary" style="flex:1" onclick="saveNotes(${tid})">Guardar</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    </div>`);
}
async function saveNotes(tid){
  try{
    await api(`/api/platform/tenants/${tid}`,{method:'PUT',
      body:{notes:$('#nf-notes').value.trim(), location:$('#nf-loc').value.trim()}});
    closeModal(); toast('Notas guardadas'); loadTenants();
  }catch(e){ toast(e.message,true); }
}

/* ---------- Crear restaurante (simplificado) ---------- */
let _TPLS = null;
function genPass(){
  const a='abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length:8},()=>a[Math.floor(Math.random()*a.length)]).join('');
}
function slugPreview(name){
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'restaurante';
}
async function createForm(){
  if(!_TPLS){ try{ _TPLS=(await api('/api/platform/templates')).templates; }catch{ _TPLS=[]; } }
  modal(`<div class="modal-head"><div><h2>Nuevo negocio</h2>
      <div class="sub">Solo necesitas el nombre: usuario y contraseña se generan solos.</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div class="field"><label>Nombre del negocio *</label>
      <input id="nt-name" placeholder="Ej. Cafetería Central, Peluquería Ana…" oninput="ntAuto()"></div>
    <div class="form-grid">
      <div class="field"><label>Usuario (se genera del nombre)</label><input id="nt-user" autocomplete="off"></div>
      <div class="field"><label>Contraseña
          <a href="#" onclick="event.preventDefault();$('#nt-pass').value=genPass()" style="color:var(--plum);font-weight:600"> · generar otra</a></label>
        <input id="nt-pass" value="${genPass()}" autocomplete="off"></div>
    </div>
    <div class="field"><label>Plan contratado</label>
      <div id="nt-plans" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="plan-pick" data-plan="basico" onclick="pickPlan('basico')">
          <div class="pp-emoji">◾</div><div class="pp-name">Básico</div><div class="pp-price">39€<span>/mes</span></div></div>
        <div class="plan-pick sel" data-plan="pro" onclick="pickPlan('pro')">
          <div class="pp-emoji">⭐</div><div class="pp-name">Pro</div><div class="pp-price">69€<span>/mes</span></div></div>
        <div class="plan-pick" data-plan="cadena" onclick="pickPlan('cadena')">
          <div class="pp-emoji">👑</div><div class="pp-name">Cadena</div><div class="pp-price">129€<span>/mes</span></div></div>
      </div>
      <input type="hidden" id="nt-plan" value="pro"></div>
    <div class="field" id="nt-chain-wrap" style="display:none">
      <label>👑 Nombre de la cadena <span class="sub">(agrupa varios locales de la misma marca)</span></label>
      <input id="nt-chain" maxlength="60" placeholder="Ej. Grupo Sabor" autocomplete="off">
      <div class="sub" style="margin-top:4px">Escribe el mismo nombre en cada local del grupo para unirlos.</div></div>
    <div class="field"><label>Tipo de negocio <span class="sub">(niveles y recompensas ya preparados por nosotros)</span></label>
      <select id="nt-tpl" onchange="ntPreview()">
        ${_TPLS.map(t=>`<option value="${t.key}">${t.emoji?t.emoji+' ':''}${esc(t.label)} — ${esc(t.desc)}</option>`).join('')}
      </select></div>
    <div id="nt-preview" class="card" style="padding:12px;background:rgba(255,255,255,.045);margin-bottom:14px"></div>
    <div class="sub" style="margin-bottom:14px">Dirección que tendrá: <code class="codebox" id="nt-slug">—</code>. Todo será editable en vivo desde su propio panel.</div>
    <button class="btn btn-primary" style="width:100%" onclick="createTenant()">Crear negocio</button>
    <p id="nt-err" class="sub" style="color:var(--bad);margin-top:10px"></p>`);
  ntPreview();
}
function pickPlan(p){
  $('#nt-plan').value = p;
  document.querySelectorAll('#nt-plans .plan-pick').forEach(el=>el.classList.toggle('sel', el.dataset.plan===p));
  const w=$('#nt-chain-wrap'); if(w) w.style.display = (p==='cadena') ? '' : 'none';
}
function ntAuto(){
  const name=$('#nt-name').value.trim();
  const slug=slugPreview(name);
  $('#nt-user').value = slug.replace(/-/g,'').slice(0,14) || '';
  $('#nt-slug').textContent = '/r/'+slug+'/';
}
function ntPreview(){
  const t=_TPLS.find(x=>x.key===$('#nt-tpl')?.value); if(!t){ $('#nt-preview').innerHTML=''; return; }
  const lv=t.levels.map(l=>`${esc(l.name)} (${l.min_xp} XP)`).join(' · ');
  const rw=t.rewards.slice(0,4).map(r=>`${esc(r.name)} — ${r.cost_xp} XP${r.min_level>1?' ('+esc(t.levels[r.min_level-1]?.name||'')+')':''}`).join(' · ');
  $('#nt-preview').innerHTML=`<strong style="font-size:13px">Incluye de serie:</strong>
    <div class="sub" style="margin-top:4px"><strong>Niveles:</strong> ${lv}</div>
    <div class="sub" style="margin-top:3px"><strong>Recompensas:</strong> ${rw}${t.rewards.length>4?' · +'+(t.rewards.length-4)+' más':''}</div>`;
}
async function createTenant(){
  try{
    const name=$('#nt-name').value.trim(), user=$('#nt-user').value.trim(), pass=$('#nt-pass').value.trim();
    const r = await api('/api/platform/tenants',{method:'POST',body:{
      name, admin_user:user, admin_password:pass, template:$('#nt-tpl').value, plan:$('#nt-plan').value,
      chain_group: ($('#nt-plan').value==='cadena' ? ($('#nt-chain')?.value.trim()||'') : '') }});
    closeModal(); toast('Negocio creado','ok');
    await loadAll();
    handoffData(r.slug, r.name, user, pass);
  }catch(e){ const el=$('#nt-err'); if(el) el.textContent=e.message; else toast(e.message,'bad'); }
}

/* ---------- Entrega al restaurante (QRs, credenciales, hoja imprimible) ---------- */
function handoff(id){
  const t = TENANTS.find(x=>x.id===id); if(!t) return;
  handoffData(t.slug, t.name, (t.admins||[])[0]||'', null);
}
function handoffData(slug, name, user, pass){
  const base = location.origin;
  const admin = `${base}/r/${slug}/admin`;
  const pub = `${base}/r/${slug}/`;
  window._HANDOFF = {slug,name,user,pass,admin,pub};
  modal(`<div class="modal-head"><div><h2>Entregar a «${esc(name)}»</h2>
      <div class="sub">3 pasos: escanean el QR del panel con su tablet → entran con sus claves → asistente de 1 minuto. Listo.</div>
    </div><span class="close" onclick="closeModal()">×</span></div>
    <div class="form-grid" style="text-align:center">
      <div><strong>1 · Panel del personal</strong><div style="margin:10px 0">${qrImg(admin,150)}</div>
        <code class="codebox">${admin}</code></div>
      <div><strong>2 · Clientes (QR/cartel)</strong><div style="margin:10px 0">${qrImg(pub,150)}</div>
        <code class="codebox">${pub}</code></div>
    </div>
    <div class="card" style="padding:14px;margin-top:16px;background:rgba(255,255,255,.045)">
      <strong>Sus claves de acceso</strong>
      <div class="sub" style="margin-top:4px">Usuario: <code class="codebox">${esc(user||'—')}</code>
        ${pass?` · Contraseña: <code class="codebox">${esc(pass)}</code> <span style="color:var(--gold)">(apúntala: no se volverá a mostrar)</span>`:' · Contraseña: la definida al crearlo (puedes restablecerla en «Gestionar»).'}</div>
    </div>
    <button class="btn btn-ghost" style="width:100%;margin-top:12px" onclick="printHandoff()">🖨 Imprimir hoja de entrega</button>`);
}
function printHandoff(){
  const h=window._HANDOFF; if(!h) return;
  const w=window.open('','_blank','width=800,height=900');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fidelia · ${esc(h.name)}</title>
  <style>body{font-family:system-ui,sans-serif;color:#231c21;max-width:640px;margin:30px auto;padding:0 20px}
  h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px}
  .sub{color:#8a7f86;font-size:13px}.grid{display:flex;gap:30px;margin-top:14px}
  .col{flex:1;text-align:center}code{background:#f4eef2;padding:3px 8px;border-radius:6px;font-weight:600;font-size:12px;word-break:break-all}
  .box{border:1px solid #eae3e7;border-radius:12px;padding:14px;margin-top:14px}
  ol{padding-left:18px;font-size:14px}li{margin-bottom:6px}</style></head><body>
  <h1>Fidelia · ${esc(h.name)}</h1>
  <div class="sub">Tu programa de fidelización — hoja de puesta en marcha</div>
  <div class="grid">
    <div class="col"><h2>Panel del personal</h2>${qrImg(h.admin,150)}<div style="margin-top:8px"><code>${h.admin}</code></div></div>
    <div class="col"><h2>Para tus clientes</h2>${qrImg(h.pub,150)}<div style="margin-top:8px"><code>${h.pub}</code></div></div>
  </div>
  <div class="box"><strong>Acceso</strong><br>Usuario: <code>${esc(h.user||'')}</code>${h.pass?` &nbsp; Contraseña: <code>${esc(h.pass)}</code>`:''}</div>
  <div class="box"><strong>Puesta en marcha (1 minuto)</strong>
  <ol><li>Escanea el QR del panel con la tablet del local y entra con tus claves.</li>
  <li>Sigue el asistente: nombre, color y moneda. Cambia la contraseña si quieres.</li>
  <li>«Añadir a pantalla de inicio» para tenerlo como app.</li>
  <li>Imprime el QR de clientes y ponlo donde tus clientes lo vean (mostrador, caja, mesas…).</li>
  <li>En cada cuenta: busca al cliente (o dalo de alta) y registra el importe. Los puntos, niveles y premios van solos.</li></ol></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

/* ---------- Gestionar restaurante ---------- */
function editForm(id){
  const t = TENANTS.find(x=>x.id===id); if(!t) return;
  modal(`<div class="modal-head"><div><h2>${esc(t.name)}</h2>
      <div class="sub">/r/${t.slug} · creado ${fdate(t.created_at)}</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div class="field"><label>Nombre</label><input id="ed-name" value="${esc(t.name)}"></div>
    <div class="field"><label>Plan contratado</label>
      <div id="ed-plans" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="plan-pick ${t.plan==='basico'?'sel':''}" data-plan="basico" onclick="pickEdPlan('basico')">
          <div class="pp-emoji">◾</div><div class="pp-name">Básico</div><div class="pp-price">39€<span>/mes</span></div></div>
        <div class="plan-pick ${t.plan==='pro'?'sel':''}" data-plan="pro" onclick="pickEdPlan('pro')">
          <div class="pp-emoji">⭐</div><div class="pp-name">Pro</div><div class="pp-price">69€<span>/mes</span></div></div>
        <div class="plan-pick ${t.plan==='cadena'?'sel':''}" data-plan="cadena" onclick="pickEdPlan('cadena')">
          <div class="pp-emoji">👑</div><div class="pp-name">Cadena</div><div class="pp-price">129€<span>/mes</span></div></div>
      </div>
      <input type="hidden" id="ed-plan" value="${esc(t.plan||'pro')}"></div>
    <div class="field" id="ed-chain-wrap" style="display:${t.plan==='cadena'?'':'none'}">
      <label>👑 Nombre de la cadena <span class="sub">(mismo nombre en cada local para agruparlos)</span></label>
      <input id="ed-chain" maxlength="60" value="${esc(t.chain_group||'')}" placeholder="Ej. Grupo Sabor" autocomplete="off"></div>
    <div class="field"><label>📝 Notas para ti (teléfono, contacto, acuerdos… solo las ves tú)</label>
      <input id="ed-notes" maxlength="300" value="${esc(t.notes||'')}" placeholder="Ej. Dueño: Paco · 612 345 678 · paga en efectivo"></div>
    <div class="field"><label>📍 Ubicación (dirección; añade un enlace al mapa en la tarjeta)</label>
      <input id="ed-loc" maxlength="200" value="${esc(t.location||'')}" placeholder="Ej. Calle Mayor 12, Alcorcón, Madrid"></div>
    <div class="field"><label>🔑 Restablecer contraseña del usuario «${esc((t.admins||[])[0]||'')}» (opcional, mínimo 8)</label>
      <input id="ed-pass" placeholder="Nueva contraseña (deja vacío para no cambiar)"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <button class="btn btn-primary" onclick="saveTenant(${t.id})">Guardar</button>
      <button class="btn ${t.active?'btn-danger':'btn-ghost'}" onclick="toggleActive(${t.id},${t.active?'false':'true'})">
        ${t.active?'Suspender acceso':'Reactivar'}</button>
    </div>
    <p class="sub" style="margin-top:12px">Suspender no borra nada: sus datos, clientes y configuración se conservan íntegros y vuelven al reactivar. Útil si un cliente deja de pagar.</p>
    <div style="display:flex;gap:12px;margin-top:6px">
      <a class="sub" style="color:var(--plum);font-weight:600" href="${location.origin}/r/${t.slug}/admin" target="_blank">Abrir su panel ↗</a>
      <a class="sub" style="color:var(--plum);font-weight:600" href="${location.origin}/r/${t.slug}/" target="_blank">Vista de clientes ↗</a>
    </div>
    <div style="margin-top:18px;padding:14px;border:1px solid #6d3730;border-radius:10px">
      <strong style="color:var(--bad)">Zona de peligro</strong>
      <div class="sub" style="margin:4px 0 10px">Eliminar borra PARA SIEMPRE el negocio, sus ${t.customers} cliente(s) y todo su historial. Si solo quiere dejar de usarlo, usa «Suspender».</div>
      <button class="btn btn-danger btn-sm" onclick="deleteForm(${t.id})">Eliminar negocio…</button>
    </div>`);
}
function pickEdPlan(p){
  $('#ed-plan').value = p;
  document.querySelectorAll('#ed-plans .plan-pick').forEach(el=>el.classList.toggle('sel', el.dataset.plan===p));
  const w=$('#ed-chain-wrap'); if(w) w.style.display = (p==='cadena') ? '' : 'none';
}
function deleteForm(id){
  const t = TENANTS.find(x=>x.id===id); if(!t) return;
  modal(`<div class="modal-head"><div><h2 style="color:var(--bad)">Eliminar «${esc(t.name)}»</h2>
      <div class="sub">Esto borra el negocio, sus ${t.customers} cliente(s), puntos, canjes e historial. <strong>No se puede deshacer</strong> (se guardará una última copia de seguridad automática antes).</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div class="field"><label>Para confirmar, escribe el nombre exacto: <strong>${esc(t.name)}</strong></label>
      <input id="del-confirm" placeholder="${esc(t.name)}" autocomplete="off"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="editForm(${t.id})">Cancelar</button>
      <button class="btn btn-danger" style="flex:1" onclick="doDeleteTenant(${t.id})">Eliminar definitivamente</button>
    </div>
    <p id="del-err" class="sub" style="color:var(--bad);margin-top:10px"></p>`);
}
async function doDeleteTenant(id){
  try{
    await api(`/api/platform/tenants/${id}/delete`,{method:'POST',body:{confirm_name:$('#del-confirm').value}});
    closeModal(); toast('Negocio eliminado','ok'); loadAll();
  }catch(e){ $('#del-err').textContent=e.message; }
}
async function saveTenant(id){
  try{
    const body={ name:$('#ed-name').value.trim(),
                 notes:$('#ed-notes').value.trim(), location:$('#ed-loc').value.trim(),
                 plan:$('#ed-plan').value,
                 chain_group: ($('#ed-plan').value==='cadena' ? ($('#ed-chain')?.value.trim()||'') : '') };
    const pw=$('#ed-pass').value; if(pw) body.reset_admin_password=pw;
    await api('/api/platform/tenants/'+id,{method:'PUT',body});
    closeModal(); toast('Guardado','ok'); loadAll();
  }catch(e){ toast(e.message,'bad'); }
}
async function toggleActive(id,active){
  try{
    await api('/api/platform/tenants/'+id,{method:'PUT',body:{active}});
    closeModal(); toast(active?'Reactivado':'Suspendido','ok'); loadAll();
  }catch(e){ toast(e.message,'bad'); }
}

/* ---------- Info / copias ---------- */
function showInfo(){
  const i=window._INFO||{};
  modal(`<div class="modal-head"><h2>Tus datos y copias</h2><span class="close" onclick="closeModal()">×</span></div>
    <p class="sub">Todos los negocios se guardan de forma permanente en un único archivo. Copias automáticas diarias (se conservan ${i.backups_kept||30}).</p>
    <div class="field"><label>Archivo de datos</label><input readonly value="${esc(i.db_path||'')}" onclick="this.select()"></div>
    <div class="field"><label>Carpeta de copias</label><input readonly value="${esc(i.backup_dir||'')}" onclick="this.select()"></div>
    <div class="field"><label>Última copia</label><input readonly value="${i.last_backup?fdate(i.last_backup):'sin copias aún'}"></div>
    <a class="btn btn-primary" href="/api/backup">⭳ Descargar copia de seguridad (.db)</a>
    <div class="card" style="padding:14px;margin-top:16px;background:rgba(255,255,255,.045)">
      <strong>Restaurar una copia</strong>
      <div class="sub" style="margin:4px 0 10px">Sube un archivo .db descargado antes. Se hará una copia del estado actual justo antes de restaurar. Tendrás que volver a iniciar sesión.</div>
      <input type="file" id="rst-file" accept=".db" style="margin-bottom:10px">
      <button class="btn btn-danger" style="width:100%" onclick="doRestore()">⟲ Restaurar esta copia</button>
      <p id="rst-msg" class="sub" style="margin-top:8px"></p>
    </div>`);
}
function pwForm(){
  modal(`<div class="modal-head"><h2>Contraseña del propietario</h2><span class="close" onclick="closeModal()">×</span></div>
    <div class="field"><label>Contraseña actual</label><input id="pp-cur" type="password"></div>
    <div class="field"><label>Nueva contraseña</label><input id="pp-new" type="password"></div>
    <button class="btn btn-primary" onclick="changePw()">Actualizar</button>`);
}
async function changePw(){
  try{
    await api('/api/platform/password',{method:'POST',body:{current_password:$('#pp-cur').value,new_password:$('#pp-new').value}});
    closeModal(); toast('Contraseña actualizada','ok');
  }catch(e){ toast(e.message,'bad'); }
}
function fdate(iso){ try{return new Date(iso).toLocaleString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return iso;} }


/* ================= FACTURACIÓN ================= */
function billingChip(b){
  if(!b || !b.enabled) return '<span style="color:var(--muted)">Cobro: manual/desactivado</span>';
  const until = b.paid_until ? new Date(b.paid_until).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const map = {
    active:    ['var(--ok)',  'Al día hasta '+until],
    past_due:  ['var(--gold)','Impago (gracia) · pagado hasta '+until],
    suspended: ['var(--bad)', 'Suspendido por impago'],
    canceled:  ['var(--bad)', 'Suscripción cancelada · hasta '+until],
    none:      ['var(--muted)','Cobro activado, sin pagos aún'],
  };
  const [c,txt] = map[b.status] || map.none;
  return `<span style="color:${c};font-weight:600">● ${txt}</span>`;
}

async function billingSettings(){
  let st={};
  try{ st=await api('/api/platform/billing/settings'); }catch(e){ toast(e.message,'bad'); return; }
  const hookUrl=(st.public_url||location.origin).replace(/\/$/,'')+st.webhook_path;
  modal(`<div class="modal-head"><div><h2>Facturación</h2>
      <div class="sub">Cobra a tus negocios por suscripción (Stripe) o al menos controla pagos manuales.</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div class="form-grid">
      <div class="field"><label>Precio mensual (€)</label><input id="bs-price" value="${esc(st.price_eur)}"></div>
      <div class="field"><label>Días de gracia tras vencer</label><input id="bs-grace" value="${esc(st.grace_days)}"></div>
    </div>
    <div class="field"><label>Clave secreta de Stripe ${st.stripe_secret_set?`· <span style="color:var(--ok)">configurada (${esc(st.stripe_secret_hint)})</span>`:''}</label>
      <input id="bs-sk" type="password" placeholder="sk_live_… (deja vacío para no cambiar)" autocomplete="off"></div>
    <div class="field"><label>Secreto del webhook ${st.webhook_secret_set?'· <span style="color:var(--ok)">configurado</span>':''}</label>
      <input id="bs-wh" type="password" placeholder="whsec_… (deja vacío para no cambiar)" autocomplete="off"></div>
    <div class="field"><label>URL pública de esta plataforma (https)</label>
      <input id="bs-url" value="${esc(st.public_url)}" placeholder="https://fidelia.tudominio.com"></div>
    <div class="card" style="padding:12px;background:rgba(255,255,255,.045);margin-bottom:14px">
      <strong style="font-size:13.5px">Configura el webhook en Stripe</strong>
      <div class="sub" style="margin-top:4px">Dashboard → Developers → Webhooks → Add endpoint:</div>
      <code class="codebox" style="display:block;margin-top:6px">${esc(hookUrl)}</code>
      <div class="sub" style="margin-top:6px">Eventos: <code class="codebox">checkout.session.completed</code>, <code class="codebox">invoice.paid</code>, <code class="codebox">invoice.payment_failed</code>, <code class="codebox">customer.subscription.deleted</code>. Copia el «Signing secret» (whsec_…) arriba.</div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="saveBillingSettings()">Guardar</button>
    <p class="sub" style="margin-top:10px">Sin Stripe también funciona: usa «Marcar pagado» en cada negocio (transferencia/efectivo) y la suspensión automática por vencimiento hará el resto.</p>`);
}
async function saveBillingSettings(){
  try{
    const body={ price_eur:$('#bs-price').value.trim(), grace_days:$('#bs-grace').value.trim(),
      public_url:$('#bs-url').value.trim() };
    if($('#bs-sk').value.trim()) body.stripe_secret=$('#bs-sk').value.trim();
    if($('#bs-wh').value.trim()) body.stripe_webhook_secret=$('#bs-wh').value.trim();
    await api('/api/platform/billing/settings',{method:'POST',body});
    closeModal(); toast('Facturación guardada','ok');
  }catch(e){ toast(e.message,'bad'); }
}

async function billingForm(id){
  const t=TENANTS.find(x=>x.id===id); if(!t) return;
  let d={billing:{},grace_days:3};
  try{ d=await api(`/api/platform/tenants/${id}/billing`); }catch(e){ toast(e.message,'bad'); return; }
  const b=d.billing;
  modal(`<div class="modal-head"><div><h2>Cobro · ${esc(t.name)}</h2>
      <div class="sub">${billingChip(b)} · gracia: ${d.grace_days} día(s)</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div class="card" style="padding:14px;background:rgba(255,255,255,.045);margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;font-weight:600;color:var(--ink)">
        <input type="checkbox" id="bf-en" style="width:auto" ${b.enabled?'checked':''} onchange="billingEnable(${id},this.checked)">
        Cobro automático activo (suspende solo al vencer el pago; nunca borra datos)
      </label>
    </div>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <div class="field" style="margin:0;max-width:120px"><label>Días</label><input id="bf-days" value="30"></div>
      <button class="btn btn-ghost" onclick="markPaid(${id})">✓ Marcar pagado</button>
      <span class="sub">Pago manual (transferencia, efectivo…)</span>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="genCheckout(${id})">💳 Generar enlace de suscripción (Stripe)</button>
    <div id="bf-link" style="margin-top:12px"></div>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:16px 0 4px">
      <div class="field" style="margin:0;max-width:150px"><label>Cuota de ESTE negocio (€/mes)</label>
        <input id="bf-price" type="number" step="0.01" value="${d.own_price??''}" placeholder="${fmtEUR(d.price)} (global)"></div>
      <button class="btn btn-ghost" onclick="savePrice(${id})">Guardar cuota</button>
      <span class="sub">Déjalo vacío para usar la cuota global.</span>
    </div>
    <div class="card" style="padding:14px;background:rgba(255,255,255,.045);margin-top:12px">
      <strong style="font-size:13.5px">Historial de pagos · total <span style="color:var(--gold)">${fmtEUR(d.revenue_total)} €</span></strong>
      ${d.payments && d.payments.length ? `<table style="width:100%;margin-top:8px;font-size:13px;border-collapse:collapse">
        ${d.payments.map(pp=>`<tr style="border-top:1px solid var(--line)">
          <td style="padding:6px 0">${fdate(pp.created_at)}</td>
          <td>${pp.method==='stripe'?'💳 Stripe':'✋ Manual'}</td>
          <td class="sub">${esc(pp.note||'')}</td>
          <td style="text-align:right;font-weight:700;color:var(--gold)">+${fmtEUR(pp.amount)} €</td></tr>`).join('')}
      </table>` : '<div class="sub" style="margin-top:6px">Aún no hay pagos registrados.</div>'}
    </div>`);
}
async function savePrice(id){
  try{
    const v=$('#bf-price').value.trim();
    await api(`/api/platform/tenants/${id}/billing/price`,{method:'POST',body:{price_eur:v||null}});
    toast('Cuota guardada','ok'); billingForm(id); loadAll();
  }catch(e){ toast(e.message,'bad'); }
}
async function billingEnable(id,enabled){
  try{ await api(`/api/platform/tenants/${id}/billing/enable`,{method:'POST',body:{enabled}});
    toast(enabled?'Cobro automático activado':'Cobro automático desactivado','ok'); loadAll();
  }catch(e){ toast(e.message,'bad'); }
}
async function markPaid(id){
  try{
    const days=parseInt($('#bf-days').value)||30;
    await api(`/api/platform/tenants/${id}/billing/mark_paid`,{method:'POST',body:{days}});
    closeModal(); toast(`Pago registrado (+${days} días)`,'ok'); loadAll();
  }catch(e){ toast(e.message,'bad'); }
}
async function genCheckout(id){
  const box=$('#bf-link'); box.innerHTML='<div class="sub">Creando enlace…</div>';
  try{
    const r=await api(`/api/platform/tenants/${id}/billing/checkout`,{method:'POST',body:{}});
    box.innerHTML=`<div class="field"><label>Envía este enlace al negocio (pagan con tarjeta y queda todo automático)</label>
      <input readonly value="${esc(r.url)}" onclick="this.select()"></div>
      <div style="text-align:center;margin-top:8px">${qrImg(r.url,140)}</div>`;
    loadAll();
  }catch(e){ box.innerHTML=`<div class="sub" style="color:var(--bad)">${esc(e.message)}</div>`; }
}


/* ================= RESTAURAR COPIA ================= */
async function doRestore(){
  const f=$('#rst-file').files[0];
  const msg=$('#rst-msg');
  if(!f){ msg.textContent='Selecciona primero un archivo .db'; msg.style.color='var(--bad)'; return; }
  if(!confirm('Se sustituirán TODOS los datos actuales por los de la copia «'+f.name+'». Se guardará una copia del estado actual antes. ¿Continuar?')) return;
  msg.textContent='Restaurando…'; msg.style.color='var(--muted)';
  try{
    const res=await fetch('/api/platform/restore',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/octet-stream'},body:f});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.detail||'Error');
    msg.textContent='✓ Copia restaurada. Recargando…'; msg.style.color='var(--ok)';
    setTimeout(()=>location.reload(),1200);
  }catch(e){ msg.textContent='✗ '+e.message; msg.style.color='var(--bad)'; }
}


/* ================= CLIENTES DE CADA RESTAURANTE ================= */
let _TC = {tid:null, q:'', status:'all', level:'', sort:'xp'};
async function tenantCustomers(tid){
  _TC = {tid, q:'', status:'all', level:'', sort:'xp'};
  modal(`<div class="modal-head"><div><h2 id="tc-title">Clientes</h2>
      <div class="sub" id="tc-sub">Gestión desde la plataforma: bloquear, ajustar puntos, revisar canjes.</div></div>
    <span class="close" onclick="closeModal()">×</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <input id="tc-q" placeholder="Buscar…" style="flex:2;min-width:160px"
        oninput="_TC.q=this.value;tcDebounce()">
      <select id="tc-status" style="max-width:130px" onchange="_TC.status=this.value;loadTC()">
        <option value="all">Todos</option><option value="active">Activos</option>
        <option value="banned">Bloqueados</option></select>
      <select id="tc-sort" style="max-width:150px" onchange="_TC.sort=this.value;loadTC()">
        <option value="xp">Más puntos</option><option value="visits">Más visitas</option>
        <option value="redemptions">Más canjes</option><option value="recent">Recientes</option></select>
    </div>
    <div id="tc-list" class="card" style="padding:0;max-height:52vh;overflow:auto"><div class="empty">Cargando…</div></div>`);
  loadTC();
}
let _tcTimer=null;
function tcDebounce(){ clearTimeout(_tcTimer); _tcTimer=setTimeout(loadTC,250); }
async function loadTC(){
  const p=_TC;
  try{
    const d=await api(`/api/platform/tenants/${p.tid}/customers?q=${encodeURIComponent(p.q)}&status=${p.status}&sort=${p.sort}`);
    $('#tc-title').textContent='Clientes · '+d.tenant.name;
    const list=$('#tc-list');
    if(!d.customers.length){ list.innerHTML='<div class="empty">Sin resultados.</div>'; return; }
    list.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:13.5px">
      <thead><tr style="text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase">
        <th style="padding:10px 12px">Cliente</th><th>Nivel</th><th>Pts</th><th>Canjes</th><th>Estado</th><th></th></tr></thead>
      <tbody>${d.customers.map(c=>`
        <tr style="border-top:1px solid var(--line);${c.active?'':'opacity:.55'}">
          <td style="padding:9px 12px"><strong>${esc(c.name)}</strong>${c.nickname?` <span class="sub">«${esc(c.nickname)}»</span>`:''}
            ${c.phone?`<div class="sub">${esc(c.phone)}</div>`:''}</td>
          <td>${c.level?esc(c.level.name):'—'}</td>
          <td style="font-weight:600">${c.xp}</td>
          <td>${c.redemptions_count||0}</td>
          <td>${c.active?'<span style="color:var(--ok)">Activo</span>':'<span style="color:var(--bad)">Bloqueado</span>'}</td>
          <td style="white-space:nowrap;padding-right:10px">
            <button class="btn btn-ghost btn-sm" onclick="tcAdjust(${c.id},'${esc(c.name)}')">± pts</button>
            <button class="btn btn-ghost btn-sm" title="${c.has_pin?'Tiene PIN · cambiar o quitar':'Sin PIN · establecer'}" onclick="tcPin(${c.id},'${esc(c.name)}',${c.has_pin?'true':'false'})">${c.has_pin?'🔒':'🔓'}</button>
            <button class="btn ${c.active?'btn-danger':'btn-ghost'} btn-sm" onclick="tcBan(${c.id},${c.active?'true':'false'})">${c.active?'⛔':'✓'}</button>
          </td></tr>`).join('')}</tbody></table>
      <div class="sub" style="padding:10px 12px">${d.total} cliente(s)</div>`;
  }catch(e){ $('#tc-list').innerHTML=`<div class="empty">${esc(e.message)}</div>`; }
}
async function tcPin(cid,name,hasPin){
  if(hasPin){
    const v=prompt(`PIN de ${name}.\n\nEscribe un PIN nuevo (4-6 números) para cambiarlo,\no deja VACÍO y acepta para QUITARLO.`,'');
    if(v===null) return;
    const pin=(v||'').replace(/\D/g,'');
    try{
      if(!pin){ await api(`/api/platform/tenants/${_TC.tid}/customers/${cid}/pin`,{method:'POST',body:{clear_pin:true}}); toast('PIN quitado','ok'); }
      else{ if(pin.length<4||pin.length>6){ toast('El PIN debe tener 4-6 números','bad'); return; }
        await api(`/api/platform/tenants/${_TC.tid}/customers/${cid}/pin`,{method:'POST',body:{set_pin:pin}}); toast('PIN cambiado','ok'); }
      loadTC();
    }catch(e){ toast(e.message,'bad'); }
  }else{
    const v=prompt(`Establecer PIN para ${name} (4-6 números):`,'');
    if(v===null) return;
    const pin=(v||'').replace(/\D/g,'');
    if(pin.length<4||pin.length>6){ toast('El PIN debe tener 4-6 números','bad'); return; }
    try{
      await api(`/api/platform/tenants/${_TC.tid}/customers/${cid}/pin`,{method:'POST',body:{set_pin:pin}});
      toast('PIN establecido','ok'); loadTC();
    }catch(e){ toast(e.message,'bad'); }
  }
}
async function tcAdjust(cid,name){
  const v=prompt('Ajustar puntos de '+name+' (usa negativo para restar):','0');
  if(v===null) return;
  const delta=parseInt(v)||0;
  if(!delta){ toast('Pon una cantidad distinta de 0','bad'); return; }
  try{
    await api(`/api/platform/tenants/${_TC.tid}/customers/${cid}/adjust`,{method:'POST',body:{delta,reason:'Ajuste del propietario de la plataforma'}});
    toast(`Ajustado ${delta>0?'+':''}${delta} pts`,'ok'); loadTC();
  }catch(e){ toast(e.message,'bad'); }
}
async function tcBan(cid,ban){
  if(!confirm(ban?'¿Bloquear a este cliente? Conserva todos sus datos; solo pierde el acceso.':'¿Desbloquear a este cliente?')) return;
  try{
    await api(`/api/platform/tenants/${_TC.tid}/customers/${cid}/ban`,{method:'POST',body:{banned:ban}});
    toast(ban?'Bloqueado':'Desbloqueado','ok'); loadTC();
  }catch(e){ toast(e.message,'bad'); }
}


/* ================= AUTO-REFRESCO DEL PANEL ================= */
function _canRefresh(){
  return $('#app') && !$('#app').classList.contains('hide') && !$('#modal-root').innerHTML;
}
setInterval(()=>{ if(_canRefresh()) loadAll().catch(()=>{}); }, 60000);
window.addEventListener('focus', ()=>{ if(_canRefresh()) loadAll().catch(()=>{}); });
