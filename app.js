'use strict';
/* YAKO HUB — Admin Panel frontend */

const state = {
  section: 'players',
  subtab: 'players',      // players | queue | disconnected
  tool: null,             // active tool page inside "Инструменты"
  servers: [],
  activeServer: 1,
  status: null,
  players: [],
  squads: [],
  events: [],
  plugins: [],
  bans: [],
  disconnected: '',
  onlineHistory: [],
  ppl: 'online',
  demo: false, demoCount: 15,
  allplayers: [], admins: [], vip: [], banlist: [], bannednames: [], bnQuery: '', profile: null, profileTab: 'Наказания',
  apQuery: '', apFrom: '', apTo: '', admQuery: '', admGroup: '',
  playerFilter: '',
  theme: 'tactical',
  style: 'default',
  me: null, perms: {}, users: [], roles: [], permKeys: [], permLabels: {}, permWarn: [],
  chat: { query: '', name: '', channel: '', from: '', to: '', profanity: false, page: 1, pageSize: 50, data: { events: [], total: 0, page: 1, pages: 1 } },
};

const LAYERS = [
  'AlBasrah_AAS_v1','AlBasrah_Invasion_v1','AlBasrah_RAAS_v1','Anvil_AAS_v1','Anvil_RAAS_v1',
  'Belaya_AAS_v1','Belaya_RAAS_v1','BlackCoast_AAS_v1','BlackCoast_RAAS_v1','Chora_AAS_v1','Chora_RAAS_v1',
  'Fallujah_AAS_v1','Fallujah_RAAS_v1','FoolsRoad_AAS_v1','FoolsRoad_RAAS_v1','GooseBay_AAS_v1','GooseBay_RAAS_v1',
  'Gorodok_AAS_v1','Gorodok_RAAS_v1','Harju_AAS_v1','Harju_RAAS_v1','Kamdesh_AAS_v1','Kamdesh_RAAS_v1',
  'Kohat_AAS_v1','Kohat_RAAS_v1','Kokan_AAS_v1','Lashkar_AAS_v1','Lashkar_RAAS_v1','Logar_AAS_v1',
  'Manicouagan_AAS_v1','Manicouagan_RAAS_v1','Mestia_AAS_v1','Mestia_RAAS_v1','Mutaha_AAS_v1','Mutaha_RAAS_v1',
  'Narva_AAS_v1','Narva_RAAS_v1','Sanxian_AAS_v1','Sanxian_RAAS_v1','Skorpo_AAS_v1','Skorpo_RAAS_v1',
  'Sumari_AAS_v1','Sumari_RAAS_v1','Tallil_AAS_v1','Tallil_RAAS_v1','Yehorivka_AAS_v1','Yehorivka_RAAS_v1',
];
const BAN_DURATIONS = [
  { v: '0', label: 'Перманентный' }, { v: '1h', label: '1 час' }, { v: '1d', label: '1 день' },
  { v: '3d', label: '3 дня' }, { v: '7d', label: '7 дней' }, { v: '1M', label: '1 месяц' },
];
const SECTION_TITLES = { chat: 'Чат', players: 'Игроки', tools: 'Инструменты', clans: 'Кланы', profile: 'Профиль', reports: 'Репорт' };

/* Helpers */
const $ = (s, r = document) => r.querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const timeStr = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour12: false });
const has = (perm) => !!(state.me && (state.me.owner || (state.perms && state.perms[perm])));

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = {}; try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
async function cmd(command, { silent = false } = {}) {
  try {
    const d = await api('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
    if (!silent) toast('✓ ' + command, 'ok');
    return d.response || '';
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); throw e; }
}
function toast(msg, kind = 'ok') {
  const t = el(`<div class="toast ${kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : ''}">${esc(msg)}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3200);
}
function modal(title, fieldsHtml, onSubmit, submitLabel = 'Подтвердить', danger = false) {
  const m = $('#modal');
  m.innerHTML = `<h3>${esc(title)}</h3><div class="fields">${fieldsHtml}</div>
    <div class="foot"><button class="btn" id="mCancel">Отмена</button>
    <button class="btn ${danger ? 'danger' : 'primary'}" id="mOk">${esc(submitLabel)}</button></div>`;
  $('#modalBg').classList.add('show');
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => { const ok = await onSubmit(); if (ok !== false) closeModal(); };
  const f = m.querySelector('input,select,textarea'); if (f) f.focus();
}
function closeModal() { $('#modalBg').classList.remove('show'); }
function confirmAction(text, onYes, danger = true) { modal('Подтверждение', `<div>${esc(text)}</div>`, async () => { await onYes(); }, 'Да', danger); }

// ---- Squad settings gear menu ----
function openSquadMenu(teamId, sid, meta, members) {
  const m = $('#modal');
  m.innerHTML = `<h3>⚙ Отряд #${esc(sid)} — ${esc(meta.name)}</h3>
    <div class="squad-menu">
      <button class="btn menu-item" id="smMsg">💬 Отправить сообщение отряду</button>
      <button class="btn menu-item" id="smMove">🔁 Перекинуть отряд на другую сторону</button>
      <button class="btn danger menu-item" id="smWipe">🧹 Стереть название отряда</button>
    </div>
    <div class="foot"><button class="btn" id="mCancel">Закрыть</button></div>`;
  $('#modalBg').classList.add('show');
  $('#mCancel').onclick = closeModal;
  $('#smMsg').onclick = () => squadMessage(teamId, sid, meta, members);
  $('#smMove').onclick = () => squadMove(teamId, sid, meta, members);
  $('#smWipe').onclick = () => squadWipeName(teamId, sid, meta);
}
function squadMessage(teamId, sid, meta, members) {
  modal(`💬 Сообщение отряду «${meta.name}»`, `<textarea id="sqMsg" rows="3" placeholder="Текст сообщения..." style="width:100%;box-sizing:border-box"></textarea><div class="muted" style="font-size:11px;margin-top:6px">Придёт каждому игроку отряда как предупреждение (${members.length} чел.)</div>`, async () => {
    const txt = ($('#sqMsg').value || '').trim();
    if (!txt) { toast('Введите текст', 'warn'); return false; }
    const ids = members.map((x) => x.steamID).filter(Boolean);
    if (!ids.length) { toast('Нет игроков в отряде', 'warn'); return; }
    for (const id of ids) { try { await cmd(`AdminWarn ${id} ${txt}`, { silent: true }); } catch (e) {} }
    toast(`✓ Отправлено ${ids.length} игрокам`, 'ok');
  }, 'Отправить');
}
function squadMove(teamId, sid, meta, members) {
  confirmAction(`Перекинуть отряд «${meta.name}» (${members.length} чел.) на другую сторону?`, async () => {
    const ids = members.map((x) => x.steamID).filter(Boolean);
    if (!ids.length) { toast('Нет игроков в отряде', 'warn'); return; }
    for (const id of ids) { try { await cmd(`AdminForceTeamChange ${id}`, { silent: true }); } catch (e) {} }
    toast(`✓ Отряд перекинут (${ids.length})`, 'ok');
    setTimeout(refreshLive, 900);
  }, false);
}
function squadWipeName(teamId, sid, meta) {
  confirmAction(`В Squad нельзя переименовать отряд по RCON — убрать название «${meta.name}» можно только распустив отряд. Распустить отряд #${sid}?`, async () => {
    await cmd(`AdminDisbandSquad ${teamId} ${sid}`);
    setTimeout(refreshLive, 700);
  });
}

/* Theme */
// ---- colour helpers ----
function _hx(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
function _toHex(r,g,b) { return '#' + [r,g,b].map((x) => Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join(''); }
function _mix(hex,t,a) { const c=_hx(hex); return _toHex(c[0]+(t-c[0])*a, c[1]+(t-c[1])*a, c[2]+(t-c[2])*a); }
function lighten(hex,a){ return _mix(hex,255,a); }
function darken(hex,a){ return _mix(hex,0,a); }
function rgba(hex,a){ const c=_hx(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function lum(hex){ const c=_hx(hex); return (0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255; }
function cssVar(n){ const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null; }
const ACCENT_VARS = ['--accent','--accent-2','--accent-dim','--ring'];
const BG_VARS = ['--bg','--bg2','--panel','--panel-grad-end','--panel-2','--panel-hi','--border','--border-soft','--text','--muted','--faint','--appbar-bg','--input-bg'];

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('active', b.dataset.theme === name));
}
function setTheme(name) {
  state.theme = name;
  // preset chosen -> drop any custom inline overrides
  [...ACCENT_VARS, ...BG_VARS].forEach((v) => document.documentElement.style.removeProperty(v));
  try { localStorage.removeItem('yako_accent'); localStorage.removeItem('yako_bg'); localStorage.setItem('yako_theme', name); } catch (e) {}
  applyTheme(name);
}
function applyAccent(hex) {
  const st = document.documentElement.style;
  st.setProperty('--accent', hex);
  st.setProperty('--accent-2', lighten(hex, 0.25));
  st.setProperty('--accent-dim', rgba(hex, 0.14));
  st.setProperty('--ring', `0 0 0 3px ${rgba(hex, 0.2)}`);
}
function setCustomAccent(hex) { applyAccent(hex); try { localStorage.setItem('yako_accent', hex); } catch (e) {} }
function applyBg(hex) {
  const light = lum(hex) > 0.6; const st = document.documentElement.style;
  st.setProperty('--bg', hex);
  st.setProperty('--bg2', light ? darken(hex,0.05) : darken(hex,0.35));
  const panel = light ? darken(hex,0.03) : lighten(hex,0.05);
  st.setProperty('--panel', panel);
  st.setProperty('--panel-grad-end', panel);
  st.setProperty('--panel-2', light ? darken(hex,0.07) : lighten(hex,0.10));
  st.setProperty('--panel-hi', light ? darken(hex,0.11) : lighten(hex,0.16));
  st.setProperty('--border', light ? darken(hex,0.16) : lighten(hex,0.20));
  st.setProperty('--border-soft', light ? darken(hex,0.09) : lighten(hex,0.12));
  st.setProperty('--text', light ? '#1b2430' : '#e4ecf5');
  st.setProperty('--muted', light ? '#5b6a7c' : '#7f8ea3');
  st.setProperty('--faint', light ? '#93a1b2' : '#55647a');
  st.setProperty('--appbar-bg', panel);
  st.setProperty('--input-bg', light ? '#ffffff' : darken(hex,0.02));
}
function setCustomBg(hex) { applyBg(hex); try { localStorage.setItem('yako_bg', hex); } catch (e) {} }
function resetCustom() {
  [...ACCENT_VARS, ...BG_VARS].forEach((v) => document.documentElement.style.removeProperty(v));
  try { localStorage.removeItem('yako_accent'); localStorage.removeItem('yako_bg'); } catch (e) {}
  applyTheme(state.theme);
}
function initTheme() {
  let saved = 'tactical', acc = null, bg = null;
  try { saved = localStorage.getItem('yako_theme') || 'tactical'; acc = localStorage.getItem('yako_accent'); bg = localStorage.getItem('yako_bg'); } catch (e) {}
  state.theme = saved; applyTheme(saved);
  if (acc) applyAccent(acc);
  if (bg) applyBg(bg);
}
function setStyle(name) {
  state.style = name;
  document.documentElement.dataset.style = name;
  try { localStorage.setItem('yako_style', name); } catch (e) {}
}
function initStyle() {
  let saved = 'default';
  try { saved = localStorage.getItem('yako_style') || 'default'; } catch (e) {}
  setStyle(saved);
}
function styleModal() {
  const themes = [['tactical','Зелёный'],['ocean','Синий'],['ice','Лёд'],['amber','Янтарь'],['slate','Сталь'],['graphite','Графит'],['black','Чёрный'],['white','Белый']];
  const cols = { tactical:'#86c440', ocean:'#4f8fe0', ice:'#7fd3ff', amber:'#e0a83a', slate:'#8b98a8', graphite:'#3a4048', black:'#0a0a0a', white:'#ffffff' };
  const curAccent = cssVar('--accent') || '#86c440';
  const curBg = cssVar('--bg') || '#0b0f14';
  modal('Стиль панели',
    `<div><div class="muted" style="margin-bottom:8px">Оформление</div>
       <div class="row" id="styleRow">
         <button class="btn ${state.style==='default'?'primary':''}" data-s="default">Обычный</button>
         <button class="btn ${state.style==='simple'?'primary':''}" data-s="simple">Простой</button>
         <button class="btn ${state.style==='sqstat'?'primary':''}" data-s="sqstat">sqstat</button>
       </div></div>
     <div><div class="muted" style="margin:14px 0 8px">Готовые темы</div>
       <div class="row" id="themeRow">${themes.map(([id,label])=>`<button class="sw2" data-t="${id}" title="${esc(label)}" style="--sw:${cols[id]}"></button>`).join('')}</div></div>
     <div><div class="muted" style="margin:14px 0 8px">Свой цвет (палитра)</div>
       <div class="row">
         <label class="field" style="flex-direction:row;align-items:center;gap:8px">Акцент <input type="color" id="cAccent" value="${curAccent}" style="width:46px;height:32px;padding:2px"></label>
         <label class="field" style="flex-direction:row;align-items:center;gap:8px">Фон <input type="color" id="cBg" value="${curBg}" style="width:46px;height:32px;padding:2px"></label>
         <button class="btn sm" id="cReset">Сбросить свой</button>
       </div>
       <div class="muted" style="font-size:11px;margin-top:8px">Выбирай любой цвет — акцент и фон применяются мгновенно и запоминаются.</div>
     </div>`,
    async () => true, 'Готово', false);
  setTimeout(() => {
    document.querySelectorAll('#styleRow button').forEach((b) => b.onclick = () => { setStyle(b.dataset.s); document.querySelectorAll('#styleRow button').forEach((x) => x.classList.toggle('primary', x.dataset.s === state.style)); });
    document.querySelectorAll('#themeRow .sw2').forEach((b) => { b.classList.toggle('active', b.dataset.t === state.theme); b.onclick = () => { setTheme(b.dataset.t); document.querySelectorAll('#themeRow .sw2').forEach((x) => x.classList.toggle('active', x.dataset.t === state.theme)); const a=$('#cAccent'), g=$('#cBg'); if(a) a.value=cssVar('--accent')||a.value; if(g) g.value=cssVar('--bg')||g.value; }; });
    const a=$('#cAccent'), g=$('#cBg');
    if (a) a.oninput = () => { setCustomAccent(a.value); document.querySelectorAll('#themeRow .sw2').forEach((x)=>x.classList.remove('active')); };
    if (g) g.oninput = () => { setCustomBg(g.value); document.querySelectorAll('#themeRow .sw2').forEach((x)=>x.classList.remove('active')); };
    const r=$('#cReset'); if (r) r.onclick = () => { resetCustom(); if(a) a.value=cssVar('--accent')||a.value; if(g) g.value=cssVar('--bg')||g.value; document.querySelectorAll('#themeRow .sw2').forEach((x)=>x.classList.toggle('active', x.dataset.t===state.theme)); };
  }, 0);
}

/* Navigation */
function setSection(sec) {
  navigate({ section: sec, ppl: sec === 'players' ? 'online' : undefined, subtab: sec === 'players' ? 'players' : undefined });
}
function setSubtab(st) { state.subtab = st; if (st === 'disconnected') loadDisconnected(); render(); }
function setTool(page) { state.tool = page; if (page === 'plugins') loadPlugins(); if (page === 'bans') loadBans(); if (page === 'squads') loadSquads(); if (page === 'users') { loadUsers(); loadRoles(); } if (page === 'roles') loadRoles(); render(); }

function render() {
  const c = $('#content'); c.innerHTML = '';
  const R = { chat: renderChat, players: renderMain, tools: renderTools, clans: renderClans, profile: renderProfile, reports: renderReports }[state.section];
  c.appendChild(R());
}

/* ---------------- Main (Игроки) ---------------- */
function renderMain() {
  const wrap = el('<div></div>');
  wrap.appendChild(renderServerTabs());
  if (state.ppl && state.ppl !== 'online') {
    wrap.appendChild(({ all: renderAllPlayers, admins: renderAdmins, vip: renderVip, banned: renderBanned, bannednames: renderBannedNames }[state.ppl])());
    return wrap;
  }
  wrap.appendChild(renderSubtabs());

  const grid = el('<div class="main-grid"></div>');
  const left = el('<div></div>');

  if (state.subtab === 'players') {
    if (state.me && state.me.owner) {
      const db = el(`<div class="row" style="margin-bottom:12px;align-items:center;gap:8px">
        <label class="field" style="flex-direction:row;align-items:center;gap:6px">🧪 Демо-игроки:<input type="number" id="demoN" min="1" max="100" value="${state.demoCount}" style="width:78px"/></label>
        <button class="btn sm primary" id="demoApply">${state.demo ? 'Обновить' : 'Показать'}</button>
        ${state.demo ? '<button class="btn sm" id="demoOff">✖ Выключить</button>' : ''}
      </div>`);
      const applyDemo = () => { const n = Math.max(1, Math.min(100, parseInt(db.querySelector('#demoN').value, 10) || 15)); state.demoCount = n; state.demo = true; fillDemo(); render(); };
      db.querySelector('#demoApply').onclick = applyDemo;
      db.querySelector('#demoN').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyDemo(); });
      const off = db.querySelector('#demoOff'); if (off) off.onclick = () => { state.demo = false; state.players = []; state.squads = []; render(); refreshLive(); };
      left.appendChild(db);
    }
    const teams = el('<div class="teams"></div>');
    teams.appendChild(renderTeamCard('1'));
    teams.appendChild(renderTeamCard('2'));
    left.appendChild(teams);
  } else if (state.subtab === 'queue') {
    left.appendChild(renderQueue());
  } else {
    left.appendChild(renderDisconnected());
  }
  grid.appendChild(left);
  grid.appendChild(renderRail());
  wrap.appendChild(grid);
  return wrap;
}

function toggleDemo() {
  state.demo = !state.demo;
  if (state.demo) fillDemo();
  else { refreshLive(); }
  render();
}
function fillDemo() {
  const N = Math.max(1, Math.min(100, state.demoCount || 15));
  const namePool = ['kweq','Yakodzo','BarsikDPR','DRAGON','Fygas','Danon','Overdose','wirast','Zan0za','АВТОКРАТ','Tim6776','KOT','Ske-let','happination','TryAgain','NaRRRzz','Sultan','papuas0101','goriton1','Popuas010','Stefland','Zanoza','KINGBOB','Boyar','Loboto','chirochka'];
  const squadNames = ['INFANTRY','ARMOR','ШТУРМ','MECH','CAS','LOGI','RECON','ALPHA','BRAVO','DELTA','TIKTOK MILITARY','ADM'];
  const rolesU = ['USA_Rifleman_01','USA_Medic_01','USA_AutomaticRifleman_01','USA_LAT_01','USA_Marksman_01','USA_Grenadier_01'];
  const rolesR = ['RGF_Rifleman_01','RGF_Medic_01','RGF_AutomaticRifleman_01','RGF_LAT_01','RGF_Marksman_01'];
  const sid = () => '765611' + Math.floor(10000000000 + Math.random() * 89999999999);
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  let id = 0, ni = 0;
  const nm = () => { const base = namePool[ni % namePool.length]; const nick = ni < namePool.length ? base : base + (Math.floor(ni / namePool.length) + 1); ni++; return nick; };
  const players = [], squads = [];
  const buildTeam = (teamId, count, faction, slRole, roleList) => {
    if (count <= 0) return;
    const unassigned = count > 6 ? Math.floor(Math.random() * 3) : 0;
    let toSquad = count - unassigned, sq = 0;
    while (toSquad > 0) {
      sq++;
      const size = Math.min(9, toSquad);
      squads.push({ squadID: String(sq), name: squadNames[(sq - 1) % squadNames.length], size, locked: Math.random() < 0.2, teamID: teamId, teamName: faction });
      for (let k = 0; k < size; k++) players.push({ id: id++, name: nm(), teamID: teamId, squadID: String(sq), role: k === 0 ? slRole : rnd(roleList), isLeader: k === 0, steamID: sid(), eosID: '' });
      toSquad -= size;
    }
    for (let u = 0; u < unassigned; u++) players.push({ id: id++, name: nm(), teamID: teamId, squadID: null, role: roleList[0], isLeader: false, steamID: sid(), eosID: '' });
  };
  const t1 = Math.ceil(N / 2), t2 = N - t1;
  buildTeam('1', t1, 'USA', 'USA_SL_01', rolesU);
  buildTeam('2', t2, 'RGF', 'RGF_SL_01', rolesR);
  state.players = players; state.squads = squads;
  state.status = {
    rcon: { connected: true, authed: true, host: 'demo', port: 0 },
    info: { serverName: '1 HYPE HUTOR (демо)', maxPlayers: 100, playerCount: N, publicQueue: 0, reservedQueue: 0, layer: 'Yehorivka_RAAS_v1', gameMode: 'RAAS', nextLayer: 'Narva_AAS_v1', teamOne: 'USA', teamTwo: 'RGF' },
    currentMap: { layer: 'Yehorivka_RAAS_v1' }, nextMap: { layer: 'Narva_AAS_v1' },
  };
  const hist = [], steps = 24, now = Date.now();
  for (let i = 1; i <= steps; i++) hist.push({ t: now - (steps - i) * 300000, v: Math.max(1, Math.round((N * i) / steps + (Math.random() * 5 - 2.5))) });
  hist[hist.length - 1].v = N;
  state.onlineHistory = hist;
  updateConn(state.status.rcon);
}

function renderServerTabs() {
  const row = el('<div class="server-tabs"></div>');
  const list = state.servers.length ? state.servers : [{ id: 1, name: 'Server 1', active: true }];
  for (const s of list) {
    let cnt, mx;
    if (s.active && state.status && state.status.info) { cnt = state.status.info.playerCount; mx = state.status.info.maxPlayers || 100; }
    else { cnt = (s.count != null ? s.count : null); mx = s.max || 100; }
    const online = s.active ? !!(state.status && state.status.rcon && state.status.rcon.authed) : !!s.online;
    const count = (cnt == null) ? '—' : `${cnt}/${mx}`;
    const tab = el(`<div class="server-tab ${s.active ? 'active' : ''} ${online ? 'online' : ''}">
      <span class="st-live"></span><span class="st-name">${esc(s.name)}</span><span class="st-count">${esc(count)}</span><span class="st-gear" title="Настройки сервера">⚙</span></div>`);
    tab.onclick = (e) => {
      if (e.target.classList.contains('st-gear')) return;
      if (state.me && state.me.owner && !s.active) serverOp({ op: 'activate', id: s.id });
    };
    tab.querySelector('.st-gear').onclick = (e) => { e.stopPropagation(); serverSettings(s); };
    row.appendChild(tab);
  }
  if (state.me && state.me.owner) {
    const add = el(`<div class="server-tab" style="min-width:auto;cursor:pointer"><span style="font-weight:700;color:var(--accent)">＋ сервер</span></div>`);
    add.onclick = () => addServerModal();
    row.appendChild(add);
  }
  return row;
}
async function serverOp(body) {
  try {
    const d = await api('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    state.servers = d.servers; const a = state.servers.find((x) => x.active); if (a) state.activeServer = a.id;
    if (body.op === 'activate') { state.players = []; state.squads = []; state.status = null; state.onlineHistory = []; _liveSig = ''; render(); showLoader('Подключение к серверу…'); pollNewServer(); }
    else { render(); setTimeout(refreshLive, 700); }
    toast('✓ Готово');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
function addServerModal() {
  modal('Добавить сервер',
    `<label class="field">Название<input id="svN" placeholder="Напр. My Squad Server"/></label>
     <label class="field">RCON хост / IP<input id="svH" placeholder="IP, 127.0.0.1 или host.docker.internal"/></label>
     <label class="field">RCON порт<input id="svP" value="21114"/></label>
     <label class="field">RCON пароль<input id="svPw"/></label>
     <div class="muted" style="font-size:11px">После добавления нажми на вкладку сервера, чтобы сделать его активным (панель переподключит RCON).</div>`,
    async () => { const name = $('#svN').value.trim(); if (!name) { toast('Введите название', 'warn'); return false; } await serverOp({ op: 'add', name, host: $('#svH').value.trim(), port: $('#svP').value.trim(), password: $('#svPw').value }); }, 'Добавить');
}
function serverSettings(s) {
  const owner = state.me && state.me.owner;
  modal(`Сервер: ${s.name}`,
    `<label class="field">Название<input id="svN" value="${esc(s.name)}" ${owner ? '' : 'readonly'}/></label>
     <label class="field">RCON хост / IP<input id="svH" value="${esc(s.host || '')}" ${owner ? '' : 'readonly'}/></label>
     <label class="field">RCON порт<input id="svP" value="${esc(s.port || '')}" ${owner ? '' : 'readonly'}/></label>
     <label class="field">RCON пароль<input id="svPw" placeholder="${s.hasPassword ? '•••••• (пусто — не менять)' : 'не задан'}" ${owner ? '' : 'readonly'}/></label>
     ${s.active ? '<div class="muted" style="font-size:12px">Это активный сервер.</div>' : ''}`,
    async () => true, 'Закрыть', false);
  if (!owner) return;
  setTimeout(() => {
    const foot = $('#modal .foot');
    foot.innerHTML = `<button class="btn danger sm" id="svDel">Удалить</button><div class="spacer"></div>${s.active ? '' : '<button class="btn sm" id="svAct">Сделать активным</button>'}<button class="btn primary sm" id="svSave">Сохранить</button>`;
    $('#svSave').onclick = async () => { await serverOp({ op: 'update', id: s.id, name: $('#svN').value.trim(), host: $('#svH').value.trim(), port: $('#svP').value.trim(), password: $('#svPw').value }); closeModal(); };
    const act = $('#svAct'); if (act) act.onclick = async () => { await serverOp({ op: 'activate', id: s.id }); closeModal(); };
    $('#svDel').onclick = () => confirmAction(`Удалить сервер «${s.name}»?`, async () => { await serverOp({ op: 'remove', id: s.id }); closeModal(); });
  }, 0);
}

function renderSubtabs() {
  const row = el('<div class="subtabs"></div>');
  const tabs = [['players', '👥 Игроки'], ['queue', '⏳ Очередь'], ['disconnected', '🚪 Отключившиеся']];
  for (const [id, label] of tabs) {
    const b = el(`<div class="subtab ${state.subtab === id ? 'active' : ''}">${label}</div>`);
    b.onclick = () => setSubtab(id);
    row.appendChild(b);
  }
  return row;
}

function factionName(teamId) {
  const info = state.status && state.status.info;
  if (info) { if (teamId === '1' && info.teamOne) return info.teamOne; if (teamId === '2' && info.teamTwo) return info.teamTwo; }
  return 'Team ' + teamId;
}

function kitName(role) {
  const r = (role || '').toLowerCase();
  if (/recruit/.test(r)) return /vdv/.test(r) ? 'vdvrecruit' : 'recruit';
  if (/slcrewman/.test(r)) return 'slcrewman';
  if (/slpilot/.test(r)) return 'slpilot';
  if (/_sl(_|$)|squadlead/.test(r)) return 'sl';
  if (/medic/.test(r)) return 'medic';
  if (/automaticrifleman|_ar(_|$)|autorifle/.test(r)) return 'ar';
  if (/marksman/.test(r)) return 'marksman';
  if (/sniper/.test(r)) return 'sniper';
  if (/grenadier/.test(r)) return 'grenadier';
  if (/machinegun|_mg(_|$)|_hmg/.test(r)) return 'machinegunner';
  if (/crewman/.test(r)) return 'crewman';
  if (/pilot|helicopter/.test(r)) return 'pilot';
  if (/_lat|lightanti/.test(r)) return 'lat';
  if (/_hat|heavyanti/.test(r)) return 'hat';
  if (/engineer/.test(r)) return 'engineer';
  if (/sapper/.test(r)) return 'sapper';
  if (/raider/.test(r)) return 'raider';
  if (/ambusher/.test(r)) return 'ambusher';
  if (/scout/.test(r)) return 'scout';
  if (/unarmed/.test(r)) return 'unarmed';
  if (/rifleman/.test(r)) return 'rifleman';
  return 'rifleman';
}
function kitIconImg(role) {
  return `<img class="kiticon" src="/assets/kits/Icon_${kitName(role)}_kit.png" alt="" loading="lazy" onerror="this.style.display='none'">`;
}
function playerRow(p) {
  const row = el(`<div class="pl-row">
    <span class="pl-role" title="${esc(p.role || '')}">${kitIconImg(p.role)}</span>
    <span class="pl-name link">${esc(p.name || ('ID ' + p.id))}</span>
    ${p.isLeader ? '<span class="pl-crown" title="Командир отряда">♛</span>' : ''}
    <span class="pl-act" title="Действия">⚙</span>
  </div>`);
  row.querySelector('.pl-name').onclick = () => openProfile(p.steamID || p.eosID || '', p.name);
  row.querySelector('.pl-act').onclick = () => playerMenu(p);
  return row;
}
// Squad faction code -> real flag file + banner gradient colors.
const FACTION = {
  RGF: { flag: 'ru', c1: '#2a5aa0', c2: '#7a1420' },
  VDV: { flag: 'vdv', c1: '#3a6a3a', c2: '#1f3d1f' },
  AFU: { flag: 'afu', c1: '#2f7ad6', c2: '#c79a1a' },
  UAF: { flag: 'afu', c1: '#2f7ad6', c2: '#c79a1a' },
  USA: { flag: 'usa', c1: '#2a3f7a', c2: '#7a1420' },
  USMC: { flag: 'usmc', c1: '#4a5a2a', c2: '#2a3416' },
  CAF: { flag: 'caf', c1: '#b01f2e', c2: '#5a1016' },
  BAF: { flag: 'baf', c1: '#1e3f8f', c2: '#7a1420' },
  ADF: { flag: 'adf', c1: '#1e5f4f', c2: '#0d2a2f' },
  PLA: { flag: 'pla', c1: '#c1121c', c2: '#6a0a10' },
  PLANMC: { flag: 'pla', c1: '#8a2020', c2: '#3a1010' },
  PLAAGF: { flag: 'plaagf', c1: '#c1121c', c2: '#6a0a10' },
  INS: { flag: 'ins', c1: '#5a5f36', c2: '#33381f' },
  IMF: { flag: 'imf', c1: '#6a5a2a', c2: '#3a2f14' },
  MEA: { flag: 'mea', c1: '#2e7d32', c2: '#14401b' },
  MEI: { flag: 'mei', c1: '#7a6a2a', c2: '#3a3214' },
  TLF: { flag: 'tlf', c1: '#c1121c', c2: '#6a0a10' },
  WPMC: { flag: 'wpmc', c1: '#555', c2: '#2a2a2a' },
  GFI: { flag: 'gfi', c1: '#6a5a2a', c2: '#3a2f14' },
  CRF: { flag: 'crf', c1: '#3a6a3a', c2: '#1f3d1f' },
};
function flagImg(code) {
  const f = (FACTION[code] && FACTION[code].flag) || 'neutral';
  return `<img class="flagimg" src="/assets/flags/${f}_flag_small.png" alt="" onerror="this.style.display='none'">`;
}
// Determine a team's faction code from its players' role prefixes (e.g. "RGF_SL_01" -> RGF).
function teamFactionCode(teamId) {
  const ps = state.players.filter((p) => p.teamID === teamId && p.role);
  for (const p of ps) {
    const pre = (p.role.split('_')[0] || '').toUpperCase();
    if (FACTION[pre]) return pre;
  }
  return null;
}
function factionColors(code) {
  return FACTION[code] || { flag: 'neutral', c1: '#3a4a5a', c2: '#232f3d' };
}
const FLAGS = {
  RU: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="13.34" fill="#fff"/><rect y="13.34" width="60" height="13.33" fill="#0039A6"/><rect y="26.67" width="60" height="13.33" fill="#D52B1E"/></svg>`,
  UA: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="20" fill="#0057B7"/><rect y="20" width="60" height="20" fill="#FFD700"/></svg>`,
  US: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#B22234"/><g fill="#fff"><rect y="3" width="60" height="3"/><rect y="9" width="60" height="3"/><rect y="15" width="60" height="3"/><rect y="21" width="60" height="3"/><rect y="27" width="60" height="3"/><rect y="33" width="60" height="3"/></g><rect width="26" height="21" fill="#3C3B6E"/><g fill="#fff"><circle cx="5" cy="4" r="1"/><circle cx="12" cy="4" r="1"/><circle cx="19" cy="4" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></g></svg>`,
  CA: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#fff"/><rect width="15" height="40" fill="#D52B1E"/><rect x="45" width="15" height="40" fill="#D52B1E"/><path d="M30 8l2 5 5-1-3 4 4 3-5 1 1 5-4-3-4 3 1-5-5-1 4-3-3-4 5 1z" fill="#D52B1E"/></svg>`,
  GB: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="4"/><rect x="24" width="12" height="40" fill="#fff"/><rect y="14" width="60" height="12" fill="#fff"/><rect x="26" width="8" height="40" fill="#C8102E"/><rect y="16" width="60" height="8" fill="#C8102E"/></svg>`,
  CN: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#DE2910"/><path d="M12 6l1.8 5.5 5.8 0-4.7 3.4 1.8 5.5-4.7-3.4-4.7 3.4 1.8-5.5-4.7-3.4 5.8 0z" fill="#FFDE00"/></svg>`,
  MEA: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="13.34" fill="#3aa03a"/><rect y="13.34" width="60" height="13.33" fill="#fff"/><rect y="26.67" width="60" height="13.33" fill="#111"/><path d="M0 0L20 20L0 40z" fill="#c62828"/></svg>`,
  AU: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#00247D"/><path d="M42 13l1.4 4.3 4.5 0-3.6 2.7 1.4 4.3-3.6-2.7-3.6 2.7 1.4-4.3-3.6-2.7 4.5 0z" fill="#fff"/></svg>`,
  TR: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#E30A17"/><circle cx="24" cy="20" r="9" fill="#fff"/><circle cx="27" cy="20" r="7" fill="#E30A17"/><path d="M35 14l1.2 3.6 3.8 0-3 2.3 1.1 3.6-3.1-2.2-3.1 2.2 1.1-3.6-3-2.3 3.8 0z" fill="#fff"/></svg>`,
  OLIVE: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#5a5f36"/></svg>`,
  GEN: `<svg class="flagsvg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#39424e"/></svg>`,
};
function factionOf(raw) {
  const s = (raw || '').toUpperCase();
  const has = (...k) => k.some((x) => s.includes(x));
  if (has('AFU', 'UKRAIN', 'ВСУ')) return { flag: FLAGS.UA, c1: '#2f7ad6', c2: '#e6b800' };
  if (has('RGF', 'VDV', 'RUSSIA', 'RUSSIAN', 'РОССИ')) return { flag: FLAGS.RU, c1: '#2a5aa0', c2: '#a11b1b' };
  if (has('USA', 'UNITED STATES', 'US ARMY', 'USMC', 'MARINE')) return { flag: FLAGS.US, c1: '#2a3f7a', c2: '#a11b1b' };
  if (has('CAF', 'CANAD')) return { flag: FLAGS.CA, c1: '#b01f2e', c2: '#7a1622' };
  if (has('BAF', 'BRITISH', 'UNITED KINGDOM')) return { flag: FLAGS.GB, c1: '#1e3f8f', c2: '#a11b1b' };
  if (has('PLA', 'CHIN')) return { flag: FLAGS.CN, c1: '#c1121c', c2: '#7a0d14' };
  if (has('MEA', 'MIDDLE')) return { flag: FLAGS.MEA, c1: '#2e7d32', c2: '#1b5e20' };
  if (has('ADF', 'AUSTRAL')) return { flag: FLAGS.AU, c1: '#1e3f8f', c2: '#0d2a63' };
  if (has('TLF', 'TURK')) return { flag: FLAGS.TR, c1: '#c1121c', c2: '#7a0d14' };
  if (has('INS', 'INSURG', 'IMF', 'MIL', 'MILITIA', 'IRREGULAR')) return { flag: FLAGS.OLIVE, c1: '#5a5f36', c2: '#3c3f24' };
  return { flag: FLAGS.GEN, c1: '#3a4a5a', c2: '#232f3d' };
}
function renderTeamCard(teamId) {
  const players = state.players.filter((p) => p.teamID === teamId);
  const squadMeta = {};
  state.squads.filter((s) => s.teamID === teamId).forEach((s) => { squadMeta[s.squadID] = s; });
  // Build the squad list from players (robust even if ListSquads returns empty),
  // merged with squad metadata (name/locked) when available.
  const squadIds = [...new Set(players.filter((p) => p.squadID).map((p) => p.squadID))];
  Object.keys(squadMeta).forEach((id) => { if (!squadIds.includes(id)) squadIds.push(id); });
  squadIds.sort((a, b) => Number(a) - Number(b));
  const unassigned = players.filter((p) => !p.squadID);

  const card = el(`<div class="team-card"></div>`);
  const code = teamFactionCode(teamId);
  const col = factionColors(code);
  const facLabel = factionName(teamId) !== ('Team ' + teamId) ? factionName(teamId) : (code || ('Team ' + teamId));
  card.appendChild(el(`<div class="team-banner">
    <div class="bg" style="background:linear-gradient(120deg, ${col.c1}, ${col.c2})"></div><div class="shade"></div>
    <div class="flag">${flagImg(code)}</div>
    <div class="stats">👥 ${players.length}<br>▦ ${squadIds.length} сквадов</div>
    <div class="fac">${esc(facLabel)}</div>
  </div>`));
  const body = el(`<div class="team-body"></div>`);
  if (!squadIds.length) body.appendChild(el(`<div class="no-squads">— 👥 Нет сквадов —</div>`));
  for (const sid of squadIds) {
    const meta = squadMeta[sid] || { squadID: sid, name: 'Отряд ' + sid, teamID: teamId, locked: false };
    const members = players.filter((p) => p.squadID === sid);
    members.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
    const head = el(`<div class="sq-head">
      <span class="sq-num">${esc(sid)}</span>
      <span class="sq-name">${esc(meta.name)}</span>
      ${meta.locked ? '<span class="sq-lock" title="Закрыт">🔒</span>' : ''}
      <span class="sq-size">${members.length}/9</span>
      <button class="sq-gear" title="Настройки отряда">⚙</button>
      <button class="sq-x" title="Распустить отряд">✕</button>
    </div>`);
    head.querySelector('.sq-gear').onclick = () => openSquadMenu(teamId, sid, meta, members);
    head.querySelector('.sq-x').onclick = () => confirmAction(`Распустить отряд #${sid} (${meta.name})?`, async () => { await cmd(`AdminDisbandSquad ${teamId} ${sid}`); setTimeout(refreshLive, 700); });
    body.appendChild(head);
    for (const p of members) body.appendChild(playerRow(p));
  }
  const un = el(`<div class="unassigned"><div class="lbl">👤× Нераспределённые игроки (${unassigned.length})</div></div>`);
  if (!unassigned.length) un.appendChild(el(`<div class="muted" style="font-size:12px;padding:4px 6px">—</div>`));
  for (const p of unassigned) un.appendChild(playerRow(p));
  body.appendChild(un);
  card.appendChild(body);
  return card;
}
function renderQueue() {
  const info = state.status && state.status.info;
  const card = el(`<div class="card"><h3>Очередь на вход</h3></div>`);
  if (!info) { card.appendChild(el(`<div class="empty">Нет данных (RCON не подключён)</div>`)); return card; }
  card.appendChild(el(`<div class="grid cards">
    <div class="card stat"><div class="label">Публичная очередь</div><div class="big">${info.publicQueue}</div></div>
    <div class="card stat"><div class="label">Очередь резерва</div><div class="big">${info.reservedQueue}</div></div>
    <div class="card stat"><div class="label">Лимит очереди</div><div class="big">${info.publicQueueLimit ?? '—'}</div></div>
  </div>`));
  card.appendChild(el(`<div class="hint muted" style="margin-top:10px">RCON отдаёт только счётчики очереди; поimённого списка нет.</div>`));
  return card;
}

function renderDisconnected() {
  const card = el(`<div class="card"><div class="row"><h3 style="margin:0">Недавно отключившиеся</h3><div class="spacer"></div><button class="btn sm" id="dcRef">Обновить</button></div></div>`);
  const out = el(`<div class="console-out" style="margin-top:12px">${state.disconnected ? esc(state.disconnected) : '<span class="muted">Нажмите «Обновить» (AdminListDisconnectedPlayers)</span>'}</div>`);
  card.appendChild(out);
  card.querySelector('#dcRef').onclick = () => loadDisconnected();
  return card;
}

// Resolve a Squad layer name (e.g. "Yehorivka_RAAS_v1") to a base map name.
const MAP_NAMES = ['AlBasrah','Anvil','Belaya','BlackCoast','Chora','Fallujah','FoolsRoad','GooseBay','Gorodok','Harju','Kamdesh','Kohat','Kokan','Lashkar','Logar','Manicouagan','Mestia','Mutaha','Narva','Sanxian','Skorpo','Sumari','Tallil','Yehorivka'];
function baseMap(layer) {
  const norm = (layer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm) { for (const m of MAP_NAMES) { if (norm.startsWith(m.toLowerCase())) return m; } }
  return null;
}
// Real top-down tactical minimaps (extracted from the game) live in czp3009/squad-map
// as huge PNGs — we route them through the wsrv.nl image CDN which downscales on the fly.
const CZP_MINIMAP = {
  AlBasrah: 'albasrah_minimap.png', Belaya: 'Belaya_Minimap.png', Chora: 'Chora1_Minimap.png',
  FoolsRoad: 'Fools_Road_v1_Minimap.png', Gorodok: 'gorodok_minimap.png', Kamdesh: 'Kamdesh_Minimap_Final.png',
  Kohat: 'kohat_minimap.png', Kokan: 'kokan_minimap.png', Logar: 'logarvalley_minimap.png',
  Mestia: 'Mestia_Minimap1.png', Narva: 'Narva_Minimap.png', Sumari: 'sumari_overlay.png',
  Yehorivka: 'yehorivka_minimap.png',
};
function wsrv(url, w) { return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&output=jpg&q=72&we`; }
// Ordered list of image URLs to try for a layer: tactical minimap -> wiki minimap -> local photo -> default.
function minimapCandidates(layer) {
  const m = baseMap(layer);
  const out = [];
  if (m && CZP_MINIMAP[m]) out.push(wsrv('https://raw.githubusercontent.com/czp3009/squad-map/master/png/' + CZP_MINIMAP[m], 680));
  if (m) out.push(wsrv('https://squad.fandom.com/wiki/Special:FilePath/' + m + '_Minimap.jpg', 680));
  if (m) out.push('/assets/maps/' + m + '.png');
  out.push('/assets/maps/default-map.png');
  return out;
}

// Server seeding status: how long it has been below the threshold, and how many players are still needed.
function fmtSeed(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s}с`;
  return `${s}с`;
}
function seedLine() {
  const sd = state.status && state.status.seeding;
  if (!sd) return '';
  if (!sd.active) return `<div class="seed-line live">🟢 Сервер набран · Live</div>`;
  const need = sd.need != null ? sd.need : '—';
  return `<div class="seed-line"><span class="seed-badge">🌱 Сидинг</span><span class="seed-time">${fmtSeed(sd.seconds)}</span><span class="seed-need">до 50 осталось ${need}</span></div>`;
}

/* ---------------- Right rail ---------------- */
function renderRail() {
  const rail = el('<div class="rail"></div>');
  const info = state.status && state.status.info;
  const count = info ? info.playerCount : 0;
  const max = info ? (info.maxPlayers || 100) : 100;

  const online = el(`<div class="rail-card">
    <div class="rail-head">📊 Онлайн</div>
    <div class="rail-body">
      <div class="online-top"><b>${count}</b><span class="cap">/ ${max} онлайн · ${Math.round((count/(max||1))*100)}%</span></div>
      ${seedLine()}
      <div class="graph-wrap">${onlineGraphSVG(state.onlineHistory, max, count)}<div class="graph-tip" id="graphTip"></div></div>
      <div class="bc-row">
        <input id="bcMsg" class="grow" placeholder="Broadcast всем игрокам…"/>
        <button class="btn primary" id="bcSend">➤</button>
      </div>
    </div>
  </div>`);
  online.querySelector('#bcSend').onclick = async () => {
    const v = online.querySelector('#bcMsg').value.trim(); if (!v) return;
    await cmd(`AdminBroadcast ${v}`); online.querySelector('#bcMsg').value = '';
  };
  online.querySelector('#bcMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter') online.querySelector('#bcSend').click(); });
  (function () {
    const svg = online.querySelector('.online-graph');
    const tip = online.querySelector('#graphTip');
    const hist = state.onlineHistory;
    if (!svg || !tip || !hist || hist.length < 2) return;
    const n = hist.length, W = 300, padL = 22, padR = 6;
    const val = (h) => (typeof h === 'number' ? h : (h && h.v) || 0);
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      let i = Math.round(((px / rect.width * W) - padL) / (W - padL - padR) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const h = hist[i];
      const when = (h && h.t) ? new Date(h.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      tip.innerHTML = `<b>${val(h)}</b> онлайн${when ? '<br><span class="muted">' + when + '</span>' : ''}`;
      tip.style.display = 'block';
      tip.style.left = Math.max(28, Math.min(rect.width - 28, px)) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  })();
  rail.appendChild(online);

  const layer = info ? (state.status.currentMap && state.status.currentMap.layer) || info.layer || '—' : '—';
  const next = info ? (state.status.nextMap && state.status.nextMap.layer) || info.nextLayer || '—' : '—';
  const map = el(`<div class="rail-card">
    <div class="rail-head">🗺 Карта</div>
    <div class="map-thumb"><img class="map-img" alt="" loading="lazy"><div class="layer">${esc(layer)}</div></div>
    <div class="rail-body">
      <div class="muted" style="font-size:12px;margin-bottom:10px">Следующая: <b style="color:var(--text)">${esc(next)}</b></div>
      <button class="btn primary block" id="mapChange">Сменить карту</button>
    </div>
  </div>`);
  map.querySelector('#mapChange').onclick = () => changeLayerModal();
  (function () {
    const mimg = map.querySelector('.map-img');
    const cands = minimapCandidates(layer);
    let ci = 0;
    mimg.onerror = () => { ci++; if (ci < cands.length) mimg.src = cands[ci]; else mimg.style.display = 'none'; };
    mimg.src = cands[0];
  })();
  rail.appendChild(map);
  return rail;
}

function niceTop(v) {
  if (v <= 10) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
function onlineGraphSVG(hist, max, current) {
  const W = 300, H = 130, padT = 10, padB = 18, padL = 22, padR = 6;
  let data = (hist && hist.length) ? hist.slice() : [];
  data = data.map((h) => (typeof h === 'number' ? h : (h && h.v) || 0));
  if (data.length === 0) data = [current || 0];
  if (data.length === 1) data = [data[0], data[0]];
  const peak = Math.max(...data, 1);
  const top = niceTop(peak);
  const n = data.length;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / top) * (H - padT - padB);
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${padL},${(H - padB).toFixed(1)} ${line} ${(W - padR).toFixed(1)},${(H - padB).toFixed(1)}`;
  const gridVals = [0, Math.round(top / 2), top];
  const grid = gridVals.map((v) => {
    const yy = y(v).toFixed(1);
    return `<line class="grid" x1="${padL}" y1="${yy}" x2="${W}" y2="${yy}"/><text class="glab" x="0" y="${(y(v) + 3).toFixed(1)}">${v}</text>`;
  }).join('');
  const lx = x(n - 1).toFixed(1), ly = y(data[n - 1]).toFixed(1);
  return `<svg class="online-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity="0.35"/>
      <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <polygon fill="url(#og)" points="${area}"/>
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" points="${line}"/>
    <circle cx="${lx}" cy="${ly}" r="3.2" fill="var(--accent)"/>
  </svg>`;
}

function donutSVG(count, max) {
  const pct = Math.max(0, Math.min(1, max ? count / max : 0));
  const r = 62, c = 2 * Math.PI * r, off = c * (1 - pct);
  return `<div class="donut"><svg viewBox="0 0 150 150" width="150" height="150">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--panel-2)" stroke-width="14"/>
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 75 75)"/>
  </svg><div class="num"><b>${count}</b><small>из ${max}</small></div></div>`;
}
function sparklineSVG(hist) {
  if (!hist || hist.length < 2) return `<div class="spark"></div>`;
  const w = 300, h = 44, max = Math.max(1, ...hist);
  const pts = hist.map((v, i) => `${(i / (hist.length - 1) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts}"/>
    <polyline fill="var(--accent-dim)" stroke="none" points="0,${h} ${pts} ${w},${h}"/>
  </svg>`;
}

/* ---------------- Player actions ---------------- */
function playerMenu(p) {
  const name = p.name || ('ID ' + p.id);
  modal(`Игрок: ${name}`,
    `<div class="muted mono" style="font-size:12px">${esc(p.steamID || p.eosID || '')}</div>
     <div class="row" style="margin-top:6px">
       <button class="btn sm" data-a="warn">Warn</button>
       <button class="btn sm warn" data-a="kick">Kick</button>
       <button class="btn sm danger" data-a="ban">Ban</button>
       <button class="btn sm" data-a="swap">Сменить команду</button>
       <button class="btn sm" data-a="unsquad">Убрать из отряда</button>
       <button class="btn sm" data-a="demote">Снять командира</button>
     </div>`, async () => true, 'Закрыть');
  setTimeout(() => {
    document.querySelectorAll('#modal button[data-a]').forEach((b) => b.onclick = () => { closeModal(); playerAction(b.dataset.a, p); });
  }, 0);
}
const WARN_DURS = '<option value="0">1 раз</option><option value="30">30 секунд</option><option value="60">1 минута</option><option value="120">2 минуты</option><option value="180">3 минуты</option>';
// Send a warn once, or repeat it every 5s for `seconds` (up to 3 min) so the popup keeps showing.
const _warnTimers = [];
function repeatWarn(cmdStr, seconds) {
  cmd(cmdStr, { silent: true }).catch(() => {});
  seconds = Math.max(0, Math.min(180, Number(seconds) || 0));
  if (!seconds) return;
  const end = Date.now() + seconds * 1000;
  const iv = setInterval(() => { if (Date.now() >= end) { clearInterval(iv); return; } cmd(cmdStr, { silent: true }).catch(() => {}); }, 5000);
  _warnTimers.push(iv);
}
function warnToast(seconds) { toast(seconds ? `⚠ Варн на ${seconds >= 60 ? (seconds / 60) + ' мин' : seconds + ' сек'}` : '✓ Предупреждение отправлено', 'warn'); }
function playerAction(action, p) {
  const name = p.name || ('ID ' + p.id);
  const after = () => setTimeout(refreshLive, 700);
  if (action === 'warn') modal(`Предупреждение — ${name}`, `<label class="field">Причина<input id="wr" placeholder="Текст"/></label><label class="field">Длительность<select id="wdur">${WARN_DURS}</select></label>`, async () => { const t = ($('#wr').value || 'Warning').trim(); const dur = Number($('#wdur').value); repeatWarn(`AdminWarnById ${p.id} ${t}`, dur); warnToast(dur); });
  else if (action === 'kick') modal(`Кик — ${name}`, `<label class="field">Причина<input id="kr"/></label>`, async () => { await cmd(`AdminKickById ${p.id} ${$('#kr').value || 'Kicked'}`); after(); }, 'Кикнуть', true);
  else if (action === 'ban') {
    const opts = BAN_DURATIONS.map((d) => `<option value="${d.v}">${d.label}</option>`).join('');
    modal(`Бан — ${name}`, `<label class="field">Срок<select id="bl">${opts}</select></label><label class="field">Причина<input id="br"/></label>`, async () => { await cmd(`AdminBanById ${p.id} ${$('#bl').value} ${$('#br').value || 'Banned'}`); after(); }, 'Забанить', true);
  } else if (action === 'swap') confirmAction(`Сменить команду игроку ${name}?`, async () => { await cmd(`AdminForceTeamChangeById ${p.id}`); after(); }, false);
  else if (action === 'unsquad') confirmAction(`Убрать ${name} из отряда?`, async () => { await cmd(`AdminRemovePlayerFromSquadById ${p.id}`); after(); }, false);
  else if (action === 'demote') confirmAction(`Снять ${name} с командира?`, async () => { await cmd(`AdminDemoteCommanderById ${p.id}`); }, false);
}

function changeLayerModal() {
  const opts = LAYERS.map((l) => `<option value="${l}">${l}</option>`).join('');
  modal('Сменить карту',
    `<label class="field">Слой<select id="lSel">${opts}</select></label>
     <label class="field">или свой<input id="lCustom" placeholder="LayerName…"/></label>`,
    async () => {
      const layer = ($('#lCustom').value.trim() || $('#lSel').value);
      const which = $('#lMode') ? $('#lMode').value : 'next';
      return true;
    }, 'Закрыть', false);
  setTimeout(() => {
    const foot = $('#modal .foot');
    foot.innerHTML = `<button class="btn" id="lNext">Следующей</button><button class="btn danger" id="lNow">Сменить сейчас</button>`;
    const layer = () => ($('#lCustom').value.trim() || $('#lSel').value);
    $('#lNext').onclick = async () => { await cmd(`AdminSetNextLayer ${layer()}`); closeModal(); setTimeout(refreshStatus, 1000); };
    $('#lNow').onclick = () => confirmAction(`Сменить карту на ${layer()} сейчас?`, async () => { await cmd(`AdminChangeLayer ${layer()}`); closeModal(); setTimeout(refreshStatus, 1500); });
  }, 0);
}

/* ---------------- Chat ---------------- */
function renderChat() {
  const CH = { ChatAll: 'Всем', ChatTeam: 'Команда', ChatSquad: 'Отряд', ChatAdmin: 'Админ' };
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="row" style="margin-bottom:12px">
    <input id="bcAll" class="grow" placeholder="Broadcast всем игрокам…"/>
    <button class="btn primary" id="bcAllSend">Broadcast</button>
  </div>`));

  const grid = el('<div class="main-grid"></div>');
  const left = el('<div></div>');
  const d = state.chat.data;
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Ник</th><th>Чат</th><th>Сообщение</th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  if (!d.events.length) tb.appendChild(el(`<tr><td colspan="4"><div class="empty">Сообщений не найдено</div></td></tr>`));
  for (const e of d.events) {
    const chan = CH[e.channel] || e.channel || '';
    const tr = el(`<tr>
      <td class="muted" style="white-space:nowrap">${fmtDate(e.time)}</td>
      <td><span class="link pl-name">${esc(e.name || '?')}</span></td>
      <td>${chan ? `<span class="badge ${e.channel === 'ChatTeam' ? 't1' : e.channel === 'ChatAdmin' ? 'lead' : 'gray'}">${esc(chan)}</span>` : ''}</td>
      <td>${e.profanity ? '<span style="color:var(--amber)" title="Мат">⚠</span> ' : ''}${esc(e.message || '')}</td>
    </tr>`);
    tr.querySelector('.pl-name').onclick = () => openProfile(e.steamID || e.eosID || '', e.name);
    tb.appendChild(tr);
  }
  left.appendChild(tbl);

  // pagination
  const pag = el(`<div class="row" style="justify-content:center;gap:8px;margin-top:14px">
    <button class="btn sm" id="chPrev" ${d.page <= 1 ? 'disabled' : ''}>←</button>
    <span class="muted">Страница ${d.page} из ${d.pages} · Всего ${d.total}</span>
    <button class="btn sm" id="chNext" ${d.page >= d.pages ? 'disabled' : ''}>→</button>
  </div>`);
  pag.querySelector('#chPrev').onclick = () => { if (state.chat.page > 1) { state.chat.page--; loadChatLog(); } };
  pag.querySelector('#chNext').onclick = () => { if (state.chat.page < d.pages) { state.chat.page++; loadChatLog(); } };
  left.appendChild(pag);
  grid.appendChild(left);

  // right filter panel
  const chanOpts = [['', '- Чат -'], ['ChatAll', 'Всем'], ['ChatTeam', 'Команда'], ['ChatSquad', 'Отряд'], ['ChatAdmin', 'Админ']]
    .map(([v, l]) => `<option value="${v}" ${state.chat.channel === v ? 'selected' : ''}>${l}</option>`).join('');
  const filt = el(`<div class="rail-card"><div class="rail-body" style="display:flex;flex-direction:column;gap:10px">
    <button class="btn primary block" id="chSearch">🔍 Поиск</button>
    <label class="field">Ник или SteamID<input id="chName" value="${esc(state.chat.name)}"/></label>
    <label class="field">Сообщение<input id="chMsg" value="${esc(state.chat.query)}"/></label>
    <label class="field">Чат<select id="chChan">${chanOpts}</select></label>
    <label class="field">С даты<input type="date" id="chFrom" value="${esc(state.chat.from)}"/></label>
    <label class="field">По дату<input type="date" id="chTo" value="${esc(state.chat.to)}"/></label>
    <label class="field" style="flex-direction:row;align-items:center;justify-content:space-between"><span>Только Мат</span><span class="switch"><input type="checkbox" id="chProf" ${state.chat.profanity ? 'checked' : ''}/><span class="slider"></span></span></label>
  </div></div>`);
  const apply = (resetPage) => {
    state.chat.name = filt.querySelector('#chName').value.trim();
    state.chat.query = filt.querySelector('#chMsg').value.trim();
    state.chat.channel = filt.querySelector('#chChan').value;
    state.chat.from = filt.querySelector('#chFrom').value;
    state.chat.to = filt.querySelector('#chTo').value;
    state.chat.profanity = filt.querySelector('#chProf').checked;
    if (resetPage) state.chat.page = 1;
    loadChatLog();
  };
  filt.querySelector('#chSearch').onclick = () => apply(true);
  filt.querySelector('#chChan').onchange = () => apply(true);
  filt.querySelector('#chProf').onchange = () => apply(true);
  filt.querySelector('#chName').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(true); });
  filt.querySelector('#chMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(true); });
  grid.appendChild(filt);
  wrap.appendChild(grid);

  wrap.querySelector('#bcAllSend').onclick = async () => { const v = wrap.querySelector('#bcAll').value.trim(); if (v) { await cmd(`AdminBroadcast ${v}`); wrap.querySelector('#bcAll').value = ''; } };
  return wrap;
}
async function loadChatLog() {
  try {
    const c = state.chat; const p = new URLSearchParams();
    if (c.query) p.set('query', c.query);
    if (c.name) p.set('name', c.name);
    if (c.channel) p.set('channel', c.channel);
    if (c.from) p.set('from', c.from);
    if (c.to) p.set('to', c.to);
    if (c.profanity) p.set('profanity', '1');
    p.set('page', c.page); p.set('pageSize', c.pageSize);
    const d = await api('/api/chatlog?' + p.toString());
    state.chat.data = d; state.chat.page = d.page;
    if (state.section === 'chat') render();
  } catch (e) {}
}

/* ---------------- Reports ---------------- */
function renderReports() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="row" style="margin-bottom:12px"><h3 style="margin:0" class="muted">Репорты и вызовы админов</h3><div class="spacer"></div><button class="btn sm" id="rRef">Обновить</button></div>`));
  const log = el(`<div class="log"></div>`);
  const reps = state.events.filter((e) => e.type === 'report');
  if (!reps.length) log.appendChild(el(`<div class="empty">Репортов нет. Игроки вызывают админов через <b>!report</b> или <b>!admins</b> (плагин Chat Commands).</div>`));
  for (const e of reps) log.appendChild(renderLogLine(e));
  wrap.appendChild(log);
  wrap.querySelector('#rRef').onclick = () => loadLog().then(render);
  return wrap;
}

function renderLogLine(e) {
  const t = `<span class="t">[${timeStr(e.time)}]</span> `;
  let node;
  if (e.type === 'chat') { const ch = e.channel ? `<span class="chan">[${esc(e.channel)}]</span> ` : ''; node = el(`<div class="line chat">${t}${ch}<strong class="pl-name link">${esc(e.name || '?')}</strong>: ${esc(e.message || e.raw || '')}</div>`); }
  else if (e.type === 'admin') node = el(`<div class="line admin">${t}⚔ ${esc(e.command)}${e.response ? ' → ' + esc(e.response) : ''}</div>`);
  else if (e.type === 'report') node = el(`<div class="line" style="color:#ffb454">${t}🚩 <strong class="pl-name link">${esc(e.name || '?')}</strong>: ${esc(e.message || '')}</div>`);
  else if (e.type === 'plugin') node = el(`<div class="line" style="color:#7fd1b9">${t}⧉ [${esc(e.plugin || '')}] ${esc(e.message || '')}</div>`);
  else if (e.type === 'event') node = el(`<div class="line" style="color:#9db4d0">${t}• ${esc(e.event || '')} ${esc(e.name || '')}</div>`);
  else node = el(`<div class="line system">${t}${esc(e.message || '')}</div>`);
  const nm = node.querySelector('.pl-name');
  if (nm) { const key = e.steamID || e.eosID || ''; nm.title = 'Открыть профиль'; nm.onclick = () => openProfile(key, e.name); }
  return node;
}

/* ---------------- Tools hub ---------------- */
function renderTools() {
  if (state.tool) return renderToolPage(state.tool);
  const wrap = el('<div></div>');
  const grid = el('<div class="tools-grid"></div>');
  let tools = [
    ['config', '⚙', 'Настройки сервера', 'Лимит игроков, пароль, очередь, slomo', 'config'],
    ['stat_kills', '🎯', 'Убийства', 'Статистика убийств', 'view'],
    ['stat_games', '🎮', 'Игры', 'Сыгранные матчи', 'view'],
    ['stat_teamkills', '⚠', 'Тимкиллы', 'Тимкиллы игроков', 'view'],
    ['stat_deaths', '💀', 'Смерти', 'Статистика смертей', 'view'],
    ['stat_damage', '💥', 'Урон', 'Нанесённый урон', 'view'],
    ['stat_revives', '✚', 'Поднятия', 'Поднятия союзников', 'view'],
  ];
  tools = tools.filter((t) => has(t[4]));
  for (const [id, ic, title, desc] of tools) {
    const c = el(`<div class="tool-card"><div class="ti">${ic}</div><h4>${title}</h4><p>${desc}</p></div>`);
    c.onclick = () => setTool(id);
    grid.appendChild(c);
  }
  wrap.appendChild(grid);
  return wrap;
}
const STAT_TITLES = { stat_kills: 'Убийства', stat_games: 'Игры', stat_teamkills: 'Тимкиллы', stat_deaths: 'Смерти', stat_damage: 'Урон', stat_revives: 'Поднятия' };
function renderStatPage(tool) {
  const w = el('<div></div>');
  const title = STAT_TITLES[tool] || 'Статистика';
  w.appendChild(el(`<div class="card"><h3>${esc(title)}</h3><div class="empty">Данных пока нет. Боевая статистика («${esc(title)}») собирается из базы SquadJS / лога сервера — это отдельный модуль, который можно подключить позже.</div></div>`));
  return w;
}
function renderToolPage(page) {
  const wrap = el('<div></div>');
  const subOfConfig = ['users', 'roles', 'plugins', 'console', 'reasons', 'discord'];
  const back = el(`<div class="back-link">← Назад</div>`);
  back.onclick = () => {
    if (subOfConfig.includes(page)) navigate({ section: 'tools', tool: 'config' });
    else navigate({ section: 'players', ppl: 'online', subtab: 'players' });
  };
  wrap.appendChild(back);
  const map = { config: renderConfig, reasons: renderReasons, discord: renderDiscord, squads: renderSquads, playerlist: renderPlayerList, bans: renderBans, plugins: renderPlugins, console: renderConsole, users: renderUsers, roles: renderRoles };
  const fn = map[page] || (String(page).startsWith('stat_') ? () => renderStatPage(page) : null);
  wrap.appendChild(fn ? fn() : el(`<div class="card"><div class="empty">Раздел не найден</div></div>`));
  return wrap;
}

function renderMatch() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="card"><h3>Управление матчем</h3><div class="row">
    <button class="btn primary" id="mChange">Сменить карту</button>
    <button class="btn warn" id="mRestart">↻ Рестарт</button>
    <button class="btn danger" id="mEnd">⏹ Завершить</button>
    <button class="btn" id="mPause">⏸ Пауза</button>
    <button class="btn" id="mUnpause">▶ Снять паузу</button>
  </div></div>`));
  wrap.querySelector('#mChange').onclick = () => changeLayerModal();
  wrap.querySelector('#mRestart').onclick = () => confirmAction('Рестарт матча?', async () => { await cmd('AdminRestartMatch'); });
  wrap.querySelector('#mEnd').onclick = () => confirmAction('Завершить матч?', async () => { await cmd('AdminEndMatch'); });
  wrap.querySelector('#mPause').onclick = async () => { await cmd('AdminPauseMatch'); };
  wrap.querySelector('#mUnpause').onclick = async () => { await cmd('AdminUnpauseMatch'); };
  return wrap;
}
function renderConfig() {
  const wrap = el('<div></div>');
  if (state.me && state.me.owner) {
    const m = el(`<div class="card"><h3>Управление (Владелец)</h3><div class="row">
      <button class="btn" data-t="users">👤 Пользователи</button>
      <button class="btn" data-t="roles">🔑 Роли и доступ</button>
      <button class="btn" data-t="plugins">⧉ Плагины</button>
      <button class="btn" data-t="console">›_ Консоль</button>
      <button class="btn" data-t="reasons">⚖ Причины / Правила</button>
      <button class="btn" data-t="discord">🔔 Discord вебхуки</button>
    </div></div>`);
    m.querySelectorAll('button[data-t]').forEach((b) => b.onclick = () => navigate({ section: 'tools', tool: b.dataset.t }));
    wrap.appendChild(m);

  } else {
    wrap.appendChild(el(`<div class="card"><div class="empty">Нет доступных настроек.</div></div>`));
  }
  return wrap;
}
function renderDiscord() {
  const wrap = el('<div></div>');
  if (!(state.me && state.me.owner)) { wrap.appendChild(el(`<div class="card"><div class="empty">Нет доступа.</div></div>`)); return wrap; }
  const d = state.discord || { enabled: false, hasWebhook: false };
  const card = el(`<div class="card"><h3>🔔 Discord — уведомления о наказаниях</h3>
    <div class="hint muted" style="margin-bottom:12px">При кике, бане и бане ника панель отправит сообщение в Discord-канал через webhook.<br>Как получить: в Discord → Настройки канала → Интеграции → Вебхуки → Новый вебхук → «Копировать URL», и вставь сюда.</div>
    <label class="field">Webhook URL<input id="dcHook" placeholder="${d.hasWebhook ? 'webhook уже сохранён — вставь новый, чтобы заменить' : 'https://discord.com/api/webhooks/...'}"/></label>
    <label class="field" style="flex-direction:row;align-items:center;justify-content:space-between;margin-top:12px"><span>Включить отправку в Discord</span><span class="switch"><input type="checkbox" id="dcEn" ${d.enabled ? 'checked' : ''}/><span class="slider"></span></span></label>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="dcSave">Сохранить</button><button class="btn" id="dcTest">Отправить тест</button>${d.hasWebhook ? '<button class="btn danger" id="dcClear">Удалить webhook</button>' : ''}</div>
    <div class="hint muted" style="margin-top:12px;font-size:11px">Статус: ${d.hasWebhook ? '🔗 webhook задан' : '— webhook не задан'} · отправка ${d.enabled ? '<b style=\'color:var(--accent)\'>включена</b>' : 'выключена'}</div>
    ${d.hasWebhook && !d.enabled ? '<div class="hint" style="margin-top:8px;font-size:12px;color:var(--amber)">⚠ Webhook сохранён, но отправка ВЫКЛЮЧЕНА — включи тумблер выше и нажми «Сохранить», иначе сообщения о банах/киках не пойдут.</div>' : ''}
  </div>`);
  const vals = () => ({ webhook: card.querySelector('#dcHook').value.trim(), enabled: card.querySelector('#dcEn').checked });
  card.querySelector('#dcSave').onclick = () => saveDiscord(vals());
  card.querySelector('#dcTest').onclick = () => saveDiscord({ ...vals(), test: true });
  const cl = card.querySelector('#dcClear'); if (cl) cl.onclick = () => confirmAction('Удалить сохранённый webhook?', async () => { await saveDiscord({ clear: true, enabled: false }); });
  wrap.appendChild(card);
  return wrap;
}
async function loadDiscord() { if (!(state.me && state.me.owner)) return; try { state.discord = await api('/api/discord'); } catch (e) {} }
async function saveDiscord(payload) {
  try {
    const d = await api('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    state.discord = d;
    if (payload && payload.test) { if (d.test) toast('✅ Тест отправлен — проверь Discord-канал'); else toast('❌ Не отправилось: ' + (d.testError || 'ошибка'), 'err'); }
    else toast('✓ Сохранено');
    if (state.section === 'tools' && state.tool === 'discord') render();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
function renderReasons() {
  const wrap = el('<div></div>');
  if (!(state.me && state.me.owner)) { wrap.appendChild(el(`<div class="card"><div class="empty">Нет доступа.</div></div>`)); return wrap; }
    state.reasons = state.reasons || [];
    const rc = el(`<div class="card"><h3>Причины наказаний / правила</h3>
      <div class="hint muted" style="margin-bottom:10px">Каждый пункт — на своей строке. <b>Заголовок</b> (как «Для игроков») — строка с «# » в начале, он выделяется и в списке причин становится группой. Тяните за <b>✥</b> для порядка.</div>
      <div id="reasonList" class="rule-list"></div>
      <div class="row" style="margin-top:12px"><input id="newReason" class="grow" placeholder="Текст пункта или заголовка…" maxlength="220"/><button class="btn primary" id="addReason">＋ Пункт</button><button class="btn" id="addHead">＋ Заголовок</button></div>
      <details style="margin-top:14px"><summary class="muted" style="cursor:pointer;font-size:12px">📋 Массово: вставить/редактировать список (один пункт на строку)</summary>
        <textarea id="bulkReasons" rows="9" style="width:100%;box-sizing:border-box;margin-top:8px;font-size:12.5px" placeholder="П.1 — Общие правила\n1.1 — На сервере запрещены…\n1.2 — …">${esc(state.reasons.join('\n'))}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="saveBulk">Сохранить список</button><span class="muted" style="font-size:11px">Полностью заменит текущий список</span></div>
      </details>
    </div>`);
    const rl = rc.querySelector('#reasonList');
    if (!state.reasons.length) rl.appendChild(el(`<div class="muted" style="font-size:12px">Список пуст — добавьте пункты ниже.</div>`));
    state.reasons.forEach((r, i) => {
      const isHead = /^#/.test(r);
      const cur = isHead ? r.replace(/^#+\s*/, '') : r;
      const row = el(`<div class="rule-row${isHead ? ' rule-head' : ''}" draggable="true"><span class="rule-grip" title="Перетащить">✥</span><span class="rule-text">${esc(cur)}</span><button class="rule-edit-btn" title="Редактировать">✎</button><button class="rule-del" title="Удалить">✕</button></div>`);
      const startEdit = () => {
        const ts = row.querySelector('.rule-text'); if (!ts || row.querySelector('.rule-edit')) return;
        row.draggable = false;
        const inp = el(`<input class="rule-edit" maxlength="220"/>`); inp.value = cur;
        ts.replaceWith(inp); inp.focus(); inp.select();
        let done = false;
        const commit = (save) => { if (done) return; done = true; if (!save) { render(); return; } const v = (inp.value || '').trim(); if (!v || v === cur) { render(); return; } const arr = state.reasons.slice(); arr[i] = isHead ? ('# ' + v.replace(/^#+\s*/, '')) : v; saveReasons(arr); };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') commit(false); });
        inp.addEventListener('blur', () => commit(true));
      };
      row.querySelector('.rule-edit-btn').onclick = startEdit;
      row.querySelector('.rule-text').addEventListener('dblclick', startEdit);
      row.querySelector('.rule-del').onclick = () => saveReasons(state.reasons.filter((_, j) => j !== i));
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); if (isNaN(from) || from === i) return; const arr = state.reasons.slice(); const [m] = arr.splice(from, 1); arr.splice(i, 0, m); saveReasons(arr); });
      rl.appendChild(row);
    });
    const addR = () => { const inp = rc.querySelector('#newReason'); const v = (inp.value || '').trim(); if (!v) return; if (state.reasons.includes(v)) { toast('Такой пункт уже есть', 'warn'); return; } saveReasons([...state.reasons, v]); };
    rc.querySelector('#addReason').onclick = addR;
    rc.querySelector('#addHead').onclick = () => { const inp = rc.querySelector('#newReason'); const v = (inp.value || '').trim(); if (!v) { toast('Введите текст заголовка', 'warn'); return; } saveReasons([...state.reasons, '# ' + v.replace(/^#+\s*/, '')]); };
    rc.querySelector('#newReason').addEventListener('keydown', (e) => { if (e.key === 'Enter') addR(); });
    rc.querySelector('#saveBulk').onclick = () => { const lines = (rc.querySelector('#bulkReasons').value || '').split('\n').map((x) => x.trim()).filter(Boolean); if (!lines.length) { toast('Список пуст', 'warn'); return; } saveReasons(lines); };
    wrap.appendChild(rc);
  return wrap;
}
function renderSquads() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="row" style="margin-bottom:12px"><span class="muted">Отрядов: ${state.squads.length}</span><div class="spacer"></div><button class="btn sm" id="sr">Обновить</button></div>`));
  if (!state.squads.length) wrap.appendChild(el(`<div class="card"><div class="empty">Нет активных отрядов</div></div>`));
  for (const tid of ['1', '2']) {
    const sq = state.squads.filter((s) => s.teamID === tid);
    if (!sq.length) continue;
    wrap.appendChild(el(`<div class="section-title"><span class="badge t${tid}">Team ${tid}</span> ${esc(factionName(tid))}</div>`));
    const grid = el('<div class="grid cards"></div>');
    for (const s of sq) {
      const c = el(`<div class="card"><div class="row"><strong>#${esc(s.squadID)} ${esc(s.name)}</strong>${s.locked ? ' 🔒' : ''}</div><div class="hint muted" style="margin:8px 0">Размер: ${s.size}</div><button class="btn sm danger">Распустить</button></div>`);
      c.querySelector('button').onclick = () => confirmAction(`Распустить #${s.squadID}?`, async () => { await cmd(`AdminDisbandSquad ${s.teamID} ${s.squadID}`); setTimeout(loadSquads, 700); });
      grid.appendChild(c);
    }
    wrap.appendChild(grid);
  }
  wrap.querySelector('#sr').onclick = () => loadSquads();
  return wrap;
}
function renderPlayerList() {
  const wrap = el('<div></div>');
  const bar = el(`<div class="row" style="margin-bottom:12px"><input class="grow" id="pf" placeholder="Поиск по имени / SteamID / ID…" value="${esc(state.playerFilter)}"/><span class="muted" id="pCount"></span><div class="spacer"></div><button class="btn sm" id="pr">Обновить</button></div>`);
  wrap.appendChild(bar);
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Имя</th><th>Ком.</th><th>Отряд</th><th>Роль</th><th>Действия</th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  const draw = () => {
    const f = (bar.querySelector('#pf').value || '').toLowerCase();
    const list = state.players.filter((p) => !f || (p.name || '').toLowerCase().includes(f) || (p.steamID || '').includes(f) || String(p.id) === f);
    bar.querySelector('#pCount').textContent = `${list.length} из ${state.players.length}`;
    tb.innerHTML = '';
    if (!list.length) { tb.appendChild(el(`<tr><td colspan="6"><div class="empty">${state.players.length ? 'Не найдено' : 'Нет игроков онлайн'}</div></td></tr>`)); return; }
    for (const p of list) {
      const tr = el(`<tr><td class="mono">${p.id}</td><td>${esc(p.name)}${p.isLeader ? ' <span class="badge lead">SL</span>' : ''}</td><td><span class="badge t${p.teamID}">${esc(p.teamID || '—')}</span></td><td>${p.squadID ? esc(p.squadID) : '<span class="muted">—</span>'}</td><td class="muted">${esc(p.role || '')}</td><td><div class="actions"><button class="btn sm" data-a="warn">W</button><button class="btn sm warn" data-a="kick">K</button><button class="btn sm danger" data-a="ban">B</button><button class="btn sm" data-a="swap">⇄</button></div></td></tr>`);
      tr.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => playerAction(b.dataset.a, p));
      tb.appendChild(tr);
    }
  };
  bar.querySelector('#pf').oninput = () => { state.playerFilter = bar.querySelector('#pf').value; draw(); };
  bar.querySelector('#pr').onclick = () => loadPlayers();
  wrap.appendChild(tbl);
  draw();
  return wrap;
}
function renderBans() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="card" style="margin-bottom:14px"><span class="muted">Баны, выданные через панель в этой сессии. Полный список — в Bans.cfg на сервере.</span></div>`));
  if (!state.bans.length) { wrap.appendChild(el(`<div class="card"><div class="empty">Банов нет</div></div>`)); return wrap; }
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>Время</th><th>Команда</th></tr></thead><tbody></tbody></table></div>`);
  for (const b of [...state.bans].reverse()) tbl.querySelector('tbody').appendChild(el(`<tr><td class="mono">${timeStr(b.time)}</td><td class="mono">${esc(b.command)}</td></tr>`));
  wrap.appendChild(tbl);
  return wrap;
}
function fmtDur(sec) {
  sec = Number(sec) || 0; const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}ч ${m}м` : `${m}м`;
}
function fmtDate(ts) { if (!ts) return '—'; const d = new Date(ts); const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Сегодня ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function groupBadge(g) {
  const low = (g || '').toLowerCase();
  const cls = /admin|админ|owner|влад|супер/.test(low) ? 't2' : /mod|модер|курат/.test(low) ? 'lead' : 'gray';
  return `<span class="badge ${cls}">${esc(g || '—')}</span>`;
}

/* ---- Все игроки ---- */
function renderAllPlayers() {
  const wrap = el('<div></div>');
  const bar = el(`<div class="card" style="margin-bottom:14px"><div class="row">
    <input id="apQ" class="grow" placeholder="Ник, прошлый ник, SteamID или EOS…" value="${esc(state.apQuery)}"/>
    <label class="field" style="flex-direction:row;align-items:center;gap:6px">с<input type="date" id="apFrom" value="${esc(state.apFrom)}"/></label>
    <label class="field" style="flex-direction:row;align-items:center;gap:6px">по<input type="date" id="apTo" value="${esc(state.apTo)}"/></label>
    <button class="btn primary" id="apGo">Найти</button>
    <button class="btn" id="apClear">Сброс</button>
    <button class="btn" id="apDemo">🧪 Тест-профиль</button>
  </div></div>`);
  wrap.appendChild(bar);

  const tbl = el(`<div class="tbl-wrap"><table><thead><tr>
    <th>SteamID</th><th>Ник</th><th>Прошлые ники</th><th>Заходил</th><th>Наиграно</th><th></th>
  </tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  if (!state.allplayers.length) tb.appendChild(el(`<tr><td colspan="6"><div class="empty">Пока никого не записано. Список наполняется, пока панель видит игроков онлайн (нужен подключённый RCON).</div></td></tr>`));
  for (const r of state.allplayers) {
    const past = r.names.filter((n) => n !== r.name).slice(-3).join(', ');
    const tr = el(`<tr>
      <td class="mono" style="color:var(--info)">${esc(r.steamID || r.eosID || '—')}</td>
      <td><span class="link" data-open>${esc(r.name || '—')}</span></td>
      <td class="muted" style="font-size:12px">${esc(past || '—')}</td>
      <td class="muted">${fmtDate(r.lastSeen)}</td>
      <td>${fmtDur(r.seconds)}</td>
      <td><div class="actions"><button class="btn sm warn" data-a="vip">VIP</button><button class="btn sm danger" data-a="ban">Ban</button></div></td>
    </tr>`);
    const _op = tr.querySelector('[data-open]'); if (_op) _op.onclick = () => openProfile(r.steamID || r.eosID);
    tr.querySelector('[data-a="vip"]').onclick = () => vipModal({ steamID: r.steamID, name: r.name });
    tr.querySelector('[data-a="ban"]').onclick = () => banModal({ steamID: r.steamID, name: r.name });
    tb.appendChild(tr);
  }
  wrap.appendChild(tbl);
  const doGo = () => { state.apQuery = bar.querySelector('#apQ').value; state.apFrom = bar.querySelector('#apFrom').value; state.apTo = bar.querySelector('#apTo').value; loadAllPlayers(); };
  bar.querySelector('#apGo').onclick = doGo;
  bar.querySelector('#apQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') doGo(); });
  bar.querySelector('#apClear').onclick = () => { state.apQuery = ''; state.apFrom = ''; state.apTo = ''; loadAllPlayers(); };
  bar.querySelector('#apDemo').onclick = () => openProfile('demo');
  return wrap;
}

/* ---- Администрация ---- */
function renderAdmins() {
  const wrap = el('<div></div>');
  const groups = [...new Set(state.admins.map((a) => a.group).filter(Boolean))];
  const gopts = ['<option value="">— Группа —</option>'].concat(groups.map((g) => `<option ${state.admGroup === g ? 'selected' : ''}>${esc(g)}</option>`)).join('');
  const bar = el(`<div class="card" style="margin-bottom:14px"><div class="row"><input id="adQ" class="grow" placeholder="Ник или SteamID…" value="${esc(state.admQuery)}"/><select id="adG">${gopts}</select><span class="muted" id="adCount"></span><button class="btn primary" id="adAdd">+ Добавить админа</button></div></div>`);
  wrap.appendChild(bar);
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>SteamID</th><th>Ник</th><th>Группа</th><th>Заходил</th><th>Discord</th><th></th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  const draw = () => {
    const q = (bar.querySelector('#adQ').value || '').toLowerCase();
    const g = bar.querySelector('#adG').value;
    let list = state.admins;
    if (q) list = list.filter((a) => (a.name || '').toLowerCase().includes(q) || (a.steamID || '').includes(q));
    if (g) list = list.filter((a) => a.group === g);
    bar.querySelector('#adCount').textContent = `${list.length} из ${state.admins.length}`;
    tb.innerHTML = '';
    if (!list.length) { tb.appendChild(el(`<tr><td colspan="6"><div class="empty">${state.admins.length ? 'Ничего не найдено' : 'Список пуст. Нажмите «Добавить админа» — или укажите adminsFilePath в config.json.'}</div></td></tr>`)); return; }
    for (const a of list) {
      const tr = el(`<tr><td class="mono" style="color:var(--info)">${esc(a.steamID)}</td><td>${esc(a.name || '—')}</td><td>${groupBadge(a.group)}</td><td class="muted">${fmtDate(a.lastSeen)}</td><td class="muted">${esc(a.discord || '—')}</td><td><div class="actions"><button class="btn sm" data-a="edit">✎</button><button class="btn sm danger" data-a="del">✕</button></div></td></tr>`);
      tr.querySelector('[data-a="edit"]').onclick = () => adminModal(a);
      tr.querySelector('[data-a="del"]').onclick = () => confirmAction(`Убрать ${a.name || a.steamID} из админов?`, async () => { await api('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true, steamID: a.steamID }) }); loadAdmins(); });
      tb.appendChild(tr);
    }
  };
  bar.querySelector('#adAdd').onclick = () => adminModal({});
  bar.querySelector('#adQ').oninput = () => { state.admQuery = bar.querySelector('#adQ').value; draw(); };
  bar.querySelector('#adG').onchange = () => { state.admGroup = bar.querySelector('#adG').value; draw(); };
  wrap.appendChild(tbl);
  draw();
  return wrap;
}
function adminModal(a) {
  const groups = ['Администратор', 'Модератор', 'Куратор', 'Владелец'];
  const gopts = groups.map((g) => `<option ${a.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('');
  modal(a.steamID ? 'Редактировать админа' : 'Добавить админа',
    `<label class="field">SteamID (17 цифр)<input id="aS" value="${esc(a.steamID || '')}" ${a.steamID ? 'readonly' : ''}/></label>
     <label class="field">Ник<input id="aN" value="${esc(a.name || '')}"/></label>
     <label class="field">Группа<select id="aG">${gopts}<option ${a.group && !groups.includes(a.group) ? 'selected' : ''} value="${esc(a.group || '')}">${esc(a.group || 'другое')}</option></select></label>
     <label class="field">Discord<input id="aD" value="${esc(a.discord || '')}"/></label>`,
    async () => {
      const steamID = $('#aS').value.trim();
      if (!/^\d{17}$/.test(steamID)) { toast('SteamID = 17 цифр', 'warn'); return false; }
      await api('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steamID, name: $('#aN').value, group: $('#aG').value, discord: $('#aD').value }) });
      toast('✓ Сохранено'); loadAdmins();
    }, 'Сохранить');
}

/* ---- Привилегии (VIP) ---- */
function renderVip() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="card" style="margin-bottom:14px"><div class="row"><span class="muted">VIP-игроки: ${state.vip.length}</span><div class="spacer"></div><button class="btn primary" id="vAdd">+ Выдать VIP</button></div></div>`));
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>SteamID</th><th>Ник</th><th>Заметка</th><th>Действует до</th><th>Заходил</th><th></th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  if (!state.vip.length) tb.appendChild(el(`<tr><td colspan="6"><div class="empty">VIP-список пуст. Нажмите «Выдать VIP».</div></td></tr>`));
  for (const v of state.vip) {
    const tr = el(`<tr>
      <td class="mono" style="color:var(--info)">${esc(v.steamID)}</td><td>${esc(v.name || '—')}</td>
      <td class="muted">${esc(v.note || '—')}</td>
      <td>${v.until ? new Date(v.until).toLocaleDateString('ru-RU') : '<span class="badge lead">∞</span>'}</td>
      <td class="muted">${fmtDate(v.lastSeen)}</td>
      <td><div class="actions"><button class="btn sm" data-a="edit">✎</button><button class="btn sm danger" data-a="del">✕</button></div></td>
    </tr>`);
    tr.querySelector('[data-a="edit"]').onclick = () => vipModal(v);
    tr.querySelector('[data-a="del"]').onclick = () => confirmAction(`Забрать VIP у ${v.name || v.steamID}?`, async () => { await api('/api/vip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true, steamID: v.steamID }) }); loadVip(); });
    tb.appendChild(tr);
  }
  wrap.appendChild(tbl);
  wrap.querySelector('#vAdd').onclick = () => vipModal({});
  return wrap;
}
function vipModal(v) {
  modal(v.steamID ? 'VIP игрок' : 'Выдать VIP',
    `<label class="field">SteamID<input id="vS" value="${esc(v.steamID || '')}" ${v.steamID ? 'readonly' : ''}/></label>
     <label class="field">Ник<input id="vN" value="${esc(v.name || '')}"/></label>
     <label class="field">Заметка<input id="vNote" value="${esc(v.note || '')}" placeholder="например: донат, куплен на месяц"/></label>
     <label class="field">Действует до (пусто = бессрочно)<input type="date" id="vU" value="${v.until ? new Date(v.until).toISOString().slice(0,10) : ''}"/></label>`,
    async () => {
      const steamID = $('#vS').value.trim();
      if (!/^\d{17}$/.test(steamID)) { toast('SteamID = 17 цифр', 'warn'); return false; }
      const until = $('#vU').value ? Date.parse($('#vU').value) : null;
      await api('/api/vip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steamID, name: $('#vN').value, note: $('#vNote').value, until }) });
      toast('✓ Сохранено'); loadVip();
    }, 'Сохранить');
}

/* ---- Забаненные ---- */
function renderBanned() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="card" style="margin-bottom:14px"><div class="row"><span class="muted">Банов: ${state.banlist.length}</span><div class="spacer"></div><button class="btn danger" id="bAdd">+ Добавить бан</button></div></div>`));
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>SteamID</th><th>Ник</th><th>Причина</th><th>Срок</th><th>Добавлен</th><th>Источник</th><th></th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  if (!state.banlist.length) tb.appendChild(el(`<tr><td colspan="7"><div class="empty">Банов нет. Добавьте вручную или укажите bansFilePath в config.json для импорта Bans.cfg.</div></td></tr>`));
  for (const b of state.banlist) {
    const tr = el(`<tr>
      <td class="mono" style="color:var(--info)">${esc(b.steamID || '—')}</td><td>${esc(b.name || '—')}</td>
      <td class="muted">${esc(b.reason || '—')}</td>
      <td>${b.duration === '0' || b.duration === 0 ? '<span class="badge t2">перм</span>' : esc(b.duration || '—')}</td>
      <td class="muted">${fmtDate(b.createdAt)}</td>
      <td><span class="badge gray">${esc(b.source || 'panel')}</span></td>
      <td><button class="btn sm danger" data-a="del">✕</button></td>
    </tr>`);
    tr.querySelector('[data-a="del"]').onclick = () => confirmAction(`Убрать бан ${b.name || b.steamID} из списка?`, async () => { await api('/api/banlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true, steamID: b.steamID, createdAt: b.createdAt }) }); loadBanlist(); });
    tb.appendChild(tr);
  }
  wrap.appendChild(tbl);
  wrap.querySelector('#bAdd').onclick = () => banModal({});
  return wrap;
}
// Build the reason <select>; lines starting with "# " become non-selectable optgroup headers.
function reasonOptions(selected) {
  let html = '<option value="">— Выберите причину —</option>';
  let open = false;
  for (const r of (state.reasons || [])) {
    if (/^#/.test(r)) {
      if (open) html += '</optgroup>';
      html += `<optgroup label="${esc(r.replace(/^#+\s*/, ''))}">`; open = true;
    } else {
      html += `<option value="${esc(r)}"${selected === r ? ' selected' : ''}>${esc(r)}</option>`;
    }
  }
  if (open) html += '</optgroup>';
  html += '<option value="__custom">✏ Другое (вписать)…</option>';
  return html;
}
function banModal(b) {
  const opts = BAN_DURATIONS.map((d) => `<option value="${d.v}">${d.label}</option>`).join('') + '<option value="kick">Кик (выгнать с сервера)</option>';
  modal(b.steamID ? `Наказание — ${b.name || b.steamID}` : 'Добавить бан',
    `<label class="field">SteamID<input id="bS" value="${esc(b.steamID || '')}"/></label>
     <label class="field">Ник<input id="bN" value="${esc(b.name || '')}"/></label>
     <label class="field">Срок<select id="bD">${opts}</select></label>
     <div class="field">Причина
       <div class="reason-picker">
         <button type="button" class="reason-toggle" id="bRtoggle"><span id="bRlabel">${b.reason && !/^#/.test(b.reason) ? esc(b.reason) : '— Выберите причину —'}</span><span class="rp-caret">▾</span></button>
         <div class="reason-menu" id="bRmenu" hidden></div>
       </div>
     </div>
     <input type="hidden" id="bRvalue" value="${b.reason && (state.reasons || []).includes(b.reason) ? esc(b.reason) : ''}"/>
     <label class="field" id="bRcustomWrap" style="display:${b.reason && !(state.reasons || []).includes(b.reason) ? '' : 'none'}">Своя причина<input id="bR" value="${esc((state.reasons || []).includes(b.reason) ? '' : (b.reason || ''))}"/></label>`,
    async () => {
      const steamID = $('#bS').value.trim();
      if (!/^\d{17}$/.test(steamID)) { toast('SteamID = 17 цифр', 'warn'); return false; }
      const dur = $('#bD').value;
      const sel = ($('#bRvalue') ? $('#bRvalue').value : '');
      const custom = ($('#bR') ? $('#bR').value : '').trim();
      const reason = ((sel && sel !== '__custom') ? sel : custom) || (dur === 'kick' ? 'Kicked' : 'Banned');
      if (dur === 'kick') { await cmd(`AdminKick ${steamID} ${reason}`); toast('✓ Игрок кикнут'); setTimeout(refreshLive, 700); return; }
      await api('/api/banlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steamID, name: $('#bN').value, duration: dur, reason, apply: true }) });
      toast('✓ Бан добавлен'); loadBanlist();
    }, 'Применить', true);
  setTimeout(() => {
    const menu = $('#bRmenu'), tgl = $('#bRtoggle'), lbl = $('#bRlabel'), val = $('#bRvalue'), cw = $('#bRcustomWrap');
    if (!menu || !tgl) return;
    let html = '';
    for (const r of (state.reasons || [])) {
      if (/^#/.test(r)) html += `<div class="rp-group">${esc(r.replace(/^#+\s*/, ''))}</div>`;
      else html += `<div class="rp-item" data-v="${esc(r)}">${esc(r)}</div>`;
    }
    html += `<div class="rp-item rp-custom" data-v="__custom">✏ Другое (вписать)…</div>`;
    menu.innerHTML = html;
    tgl.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    menu.querySelectorAll('.rp-item').forEach((it) => it.onclick = () => {
      const v = it.dataset.v; menu.hidden = true;
      if (v === '__custom') { val.value = '__custom'; lbl.textContent = '✏ Другое (вписать)'; if (cw) cw.style.display = ''; const ci = $('#bR'); if (ci) ci.focus(); }
      else { val.value = v; lbl.textContent = v; if (cw) cw.style.display = 'none'; }
    });
    document.addEventListener('click', (e) => { if (menu && !e.target.closest('.reason-picker')) menu.hidden = true; });
  }, 0);
}

/* loaders */
async function loadAllPlayers() {
  try { const p = new URLSearchParams(); if (state.apQuery) p.set('query', state.apQuery); if (state.apFrom) p.set('from', state.apFrom); if (state.apTo) p.set('to', state.apTo);
    const d = await api('/api/allplayers?' + p.toString()); state.allplayers = d.players; if (state.section === 'players' && state.ppl === 'all') render(); } catch (e) {}
}
async function loadAdmins() { try { const d = await api('/api/admins'); state.admins = d.admins; if (state.section === 'players' && state.ppl === 'admins') render(); } catch (e) {} }
async function loadVip() { try { const d = await api('/api/vip'); state.vip = d.vip; if (state.section === 'players' && state.ppl === 'vip') render(); } catch (e) {} }
async function loadReasons() { try { const d = await api('/api/reasons'); state.reasons = d.reasons || []; } catch (e) {} }
async function saveReasons(list) {
  try { const d = await api('/api/reasons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reasons: list }) }); state.reasons = d.reasons || []; toast('✓ Сохранено'); if (state.section === 'tools' && (state.tool === 'reasons' || state.tool === 'config')) render(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
async function loadBanlist() { try { const d = await api('/api/banlist'); state.banlist = d.bans; if (state.section === 'players' && state.ppl === 'banned') render(); } catch (e) {} }
async function loadUsers() { try { const d = await api('/api/users'); state.users = d.users; if (state.section === 'tools' && state.tool === 'users') render(); } catch (e) {} }
async function loadRoles() { try { const d = await api('/api/roles'); state.roles = d.roles; state.permKeys = d.permKeys; state.permLabels = d.permLabels; state.permWarn = d.permWarn || []; if (state.section === 'tools' && (state.tool === 'roles' || state.tool === 'users')) render(); } catch (e) {} }

function renderUsers() {
  const w = el('<div></div>');
  if (!state.me || !state.me.owner) { w.appendChild(el(`<div class="card"><div class="empty">Доступно только Владельцу.</div></div>`)); return w; }
  w.appendChild(el(`<div class="card" style="margin-bottom:14px"><div class="row"><span class="muted">Пользователей: ${state.users.length}</span><div class="spacer"></div><button class="btn primary" id="uAdd">+ Добавить пользователя</button></div></div>`));
  const roleOpts = ['owner'].concat(state.roles.filter((r) => r.name !== 'owner').map((r) => r.name));
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>Логин</th><th>Роль</th><th>SteamID</th><th>Статус</th><th>Создан</th><th></th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  for (const u of state.users) {
    const opts = roleOpts.map((r) => `<option value="${esc(r)}" ${u.role === r ? 'selected' : ''}>${esc(r === 'owner' ? 'Владелец' : r)}</option>`).join('');
    const tr = el(`<tr>
      <td><b>${esc(u.username)}</b></td>
      <td><select data-role>${opts}</select></td>
      <td class="mono" style="font-size:11px;color:var(--info)">${esc(u.steamID || '—')}</td>
      <td>${u.disabled ? '<span class="badge t2">заблокирован</span>' : '<span class="badge lead">активен</span>'}</td>
      <td class="muted">${fmtDate(u.createdAt)}</td>
      <td><div class="actions"><button class="btn sm" data-a="steam">🎮 Steam</button><button class="btn sm" data-a="toggle">${u.disabled ? 'Разблок.' : 'Блок.'}</button><button class="btn sm" data-a="pw">Пароль</button><button class="btn sm danger" data-a="del">✕</button></div></td>
    </tr>`);
    tr.querySelector('[data-role]').onchange = (e) => userOp({ op: 'update', username: u.username, role: e.target.value });
    tr.querySelector('[data-a="toggle"]').onclick = () => userOp({ op: 'update', username: u.username, disabled: !u.disabled });
    tr.querySelector('[data-a="pw"]').onclick = () => modal(`Сброс пароля — ${u.username}`, `<label class="field">Новый пароль<input id="np" type="text"/></label>`, async () => { const v = $('#np').value; if (!v) return false; await userOp({ op: 'update', username: u.username, password: v }); });
    tr.querySelector('[data-a="steam"]').onclick = () => modal(`SteamID — ${u.username}`, `<label class="field">SteamID (17 цифр, пусто = отвязать)<input id="sid" value="${esc(u.steamID || '')}"/></label><div class="muted" style="font-size:11px">С привязанным SteamID можно входить кнопкой «Войти через Steam».</div>`, async () => { const v = $('#sid').value.trim(); if (v && !/^\d{17}$/.test(v)) { toast('SteamID = 17 цифр', 'warn'); return false; } await userOp({ op: 'update', username: u.username, steamID: v }); });
    tr.querySelector('[data-a="del"]').onclick = () => confirmAction(`Удалить пользователя ${u.username}?`, () => userOp({ op: 'remove', username: u.username }));
    tb.appendChild(tr);
  }
  w.appendChild(tbl);
  w.querySelector('#uAdd').onclick = () => {
    const opts = roleOpts.map((r) => `<option value="${esc(r)}">${esc(r === 'owner' ? 'Владелец' : r)}</option>`).join('');
    modal('Новый пользователь', `<label class="field">Логин<input id="uu"/></label><label class="field">Пароль<input id="up" type="text"/></label><label class="field">Роль<select id="ur">${opts}</select></label><label class="field">SteamID (необязательно)<input id="us" placeholder="для входа через Steam"/></label>`,
      async () => { const username = $('#uu').value.trim(); const password = $('#up').value; const sid = $('#us').value.trim(); if (!username || !password) { toast('Заполни логин и пароль', 'warn'); return false; } if (sid && !/^\d{17}$/.test(sid)) { toast('SteamID = 17 цифр', 'warn'); return false; } await userOp({ op: 'create', username, password, role: $('#ur').value, steamID: sid }); }, 'Создать');
  };
  return w;
}
async function userOp(body) { try { await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); toast('✓ Готово'); loadUsers(); } catch (e) { toast('Ошибка: ' + e.message, 'err'); } }

function renderRoles() {
  const w = el('<div></div>');
  const owner = state.me && state.me.owner;
  w.appendChild(el(`<div class="card" style="margin-bottom:14px"><div class="row"><span class="muted">🛈 Больше информации по правам</span><a href="https://squad.fandom.com/wiki/Server_Administration" target="_blank" rel="noopener" style="color:var(--accent);font-size:12px">squad.fandom.com/wiki/Server_Administration</a><div class="spacer"></div>${owner ? '<button class="btn primary" id="rAdd">+ Создать роль</button>' : ''}</div></div>`));
  const warn = new Set(state.permWarn || []);
  for (const r of state.roles) {
    if (r.name === 'owner') {
      w.appendChild(el(`<div class="card" style="margin-bottom:14px"><div class="row"><span style="width:14px;height:14px;border-radius:4px;background:${r.color || '#86c440'};display:inline-block"></span><strong style="font-size:15px">Владелец</strong><span class="badge lead">все права</span></div><div class="hint muted" style="margin-top:8px">Полный доступ ко всему. Не редактируется.</div></div>`));
      continue;
    }
    const card = el(`<div class="card" style="margin-bottom:14px"></div>`);
    card.appendChild(el(`<div class="row" style="gap:24px;align-items:flex-start">
      <label class="field" style="min-width:210px"><span>📝 Название</span><input data-f="name" value="${esc(r.name)}" readonly title="Имя роли менять нельзя (это идентификатор)"/></label>
      <label class="field"><span>🎨 Цвет</span><span class="row" style="gap:8px"><input type="color" data-f="color" value="${r.color || '#888888'}" style="width:46px;height:32px;padding:2px" ${owner ? '' : 'disabled'}/><input data-f="colorhex" value="${(r.color || '#888888').toUpperCase()}" style="width:110px" ${owner ? '' : 'disabled'}/></span></label>
    </div>`));
    card.appendChild(el(`<div class="muted" style="margin:14px 0 8px;font-size:12px">≣ Права</div>`));
    const grid = el(`<div class="perm-cols"></div>`);
    for (const k of state.permKeys) grid.appendChild(el(`<label><input type="checkbox" data-perm="${k}" ${r.permissions[k] ? 'checked' : ''} ${owner ? '' : 'disabled'}/> ${esc(k)}${warn.has(k) ? ' <span title="Опасное право" style="color:var(--amber)">⚠</span>' : ''}</label>`));
    card.appendChild(grid);
    if (owner) {
      const cp = card.querySelector('[data-f="color"]'), ch = card.querySelector('[data-f="colorhex"]');
      cp.oninput = () => { ch.value = cp.value.toUpperCase(); };
      ch.oninput = () => { const v = ch.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) cp.value = v[0] === '#' ? v : '#' + v; };
      const foot = el(`<div class="row" style="margin-top:12px"><button class="btn primary sm" data-a="save">Сохранить</button><button class="btn danger sm" data-a="del">Удалить роль</button></div>`);
      foot.querySelector('[data-a="save"]').onclick = async () => {
        const permissions = {}; card.querySelectorAll('[data-perm]').forEach((cb) => permissions[cb.dataset.perm] = cb.checked);
        await roleOp({ op: 'save', name: r.name, color: cp.value, permissions });
      };
      foot.querySelector('[data-a="del"]').onclick = () => confirmAction(`Удалить роль «${r.name}»?`, () => roleOp({ op: 'remove', name: r.name }));
      card.appendChild(foot);
    }
    w.appendChild(card);
  }
  const add = w.querySelector('#rAdd');
  if (add) add.onclick = () => modal('Новая роль', `<label class="field">Название<input id="rn" placeholder="например: Хелпер"/></label><label class="field">Цвет<input type="color" id="rc" value="#5c9a3f" style="width:46px;height:32px;padding:2px"/></label>`, async () => { const name = $('#rn').value.trim(); if (!name) return false; await roleOp({ op: 'save', name, color: $('#rc').value, permissions: {} }); }, 'Создать');
  return w;
}
async function roleOp(body) { try { await api('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); toast('✓ Готово'); loadRoles(); } catch (e) { toast('Ошибка: ' + e.message, 'err'); } }

function renderBannedNames() {
  const wrap = el('<div></div>');
  const bar = el(`<div class="card" style="margin-bottom:14px"><div class="row"><input id="bnQ" class="grow" placeholder="Поиск по нику или причине…" value="${esc(state.bnQuery)}"/><span class="muted" id="bnCount"></span><div class="spacer"></div><button class="btn danger" id="bnAdd">+ Добавить ник</button></div><div class="hint muted" style="margin-top:8px">Список запрещённых никнеймов (отдельно от банов по SteamID).</div></div>`);
  wrap.appendChild(bar);
  const tbl = el(`<div class="tbl-wrap"><table><thead><tr><th>Ник</th><th>Причина</th><th>Добавлен</th><th></th></tr></thead><tbody></tbody></table></div>`);
  const tb = tbl.querySelector('tbody');
  const draw = () => {
    const q = (bar.querySelector('#bnQ').value || '').trim().toLowerCase();
    const list = state.bannednames.filter((b) => !q || (b.name || '').toLowerCase().includes(q) || (b.reason || '').toLowerCase().includes(q));
    bar.querySelector('#bnCount').textContent = `${list.length} из ${state.bannednames.length}`;
    tb.innerHTML = '';
    if (!list.length) { tb.appendChild(el(`<tr><td colspan="4"><div class="empty">${state.bannednames.length ? 'Ничего не найдено' : 'Список пуст. Нажмите «Добавить ник».'}</div></td></tr>`)); return; }
    for (const b of list) {
      const tr = el(`<tr><td><b>${esc(b.name)}</b></td><td class="muted">${esc(b.reason || '—')}</td><td class="muted">${fmtDate(b.createdAt)}</td><td><button class="btn sm danger" data-a="del">✕</button></td></tr>`);
      tr.querySelector('[data-a="del"]').onclick = () => confirmAction(`Убрать ник «${b.name}» из списка?`, async () => { await api('/api/bannednames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true, name: b.name, createdAt: b.createdAt }) }); loadBannedNames(); });
      tb.appendChild(tr);
    }
  };
  bar.querySelector('#bnQ').oninput = () => { state.bnQuery = bar.querySelector('#bnQ').value; draw(); };
  wrap.querySelector('#bnAdd').onclick = () => modal('Запретить ник', `<label class="field">Никнейм<input id="bnN" placeholder="точный ник"/></label><label class="field">Причина<input id="bnR" placeholder="необязательно"/></label>`, async () => { const name = $('#bnN').value.trim(); if (!name) { toast('Введите ник', 'warn'); return false; } await api('/api/bannednames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, reason: $('#bnR').value }) }); toast('✓ Добавлено'); loadBannedNames(); }, 'Запретить', true);
  wrap.appendChild(tbl);
  draw();
  return wrap;
}
async function loadBannedNames() { try { const d = await api('/api/bannednames'); state.bannednames = d.names; if (state.section === 'players' && state.ppl === 'bannednames') render(); } catch (e) {} }

async function openProfile(key, name) {
  try {
    const d = await api('/api/player?key=' + encodeURIComponent(key || ''));
    let prof = d.profile;
    if (!prof) {
      const isSteam = /^\d{17}$/.test(key || '');
      if (state.demo) {
        prof = {
          name: name || 'Игрок', steamID: isSteam ? key : ('76561' + Math.floor(1e13 + Math.random() * 8e13)), eosID: '',
          names: [name, name + '_old', 'ex_' + name].filter(Boolean),
          seconds: 3600 * (20 + Math.floor(Math.random() * 180)), bonuses: Math.floor(Math.random() * 5000), boostSeconds: 0, seedSeconds: 60 * Math.floor(30 + Math.random() * 600),
          location: 'Россия — Москва', discord: '', isAdmin: false, isVip: false, isBanned: false,
          stats: { winRate: 40 + Math.floor(Math.random() * 40), kit: 'Rifleman', kd: Number((0.5 + Math.random() * 2).toFixed(2)), kills: Math.floor(Math.random() * 800), deaths: Math.floor(Math.random() * 600), revives: Math.floor(Math.random() * 300), warns: [], teamkills: [], squads: [], kits: [], punishments: [], daily: demoDaily() },
        };
      } else {
        prof = { name: name || key || 'Игрок', steamID: isSteam ? key : '', eosID: (!isSteam && key) ? key : '', names: name ? [name] : [], seconds: 0, bonuses: 0, boostSeconds: 0, location: null, discord: '', isAdmin: false, isVip: false, isBanned: false, stats: null, notFound: true };
      }
    }
    state.profile = prof; state.profileTab = 'Наказания';
    showProfilePopup();
  } catch (e) { toast('Не удалось открыть профиль: ' + e.message, 'err'); }
}
function showProfilePopup() {
  let bg = document.getElementById('profileBg');
  if (!bg) {
    bg = el(`<div class="modal-bg" id="profileBg"><div class="modal profile-pop" id="profileCard"></div></div>`);
    document.body.appendChild(bg);
    bg.addEventListener('click', (e) => { if (e.target.id === 'profileBg') closeProfile(); });
  }
  bg.classList.add('show');
  drawProfile();
}
function closeProfile() { const b = document.getElementById('profileBg'); if (b) b.classList.remove('show'); }
function drawProfile() { const card = document.getElementById('profileCard'); if (!card) return; card.innerHTML = ''; card.appendChild(renderPlayerProfile()); }
function demoDaily() {
  const out = [];
  for (let i = 89; i >= 0; i--) {
    const b = Math.random();
    let h = b < 0.4 ? 0 : b < 0.8 ? Math.random() * 3 : 3 + Math.random() * 8;
    h = Math.round(h * 10) / 10;
    out.push({ t: Date.now() - i * 86400000, h, red: h > 6 && Math.random() < 0.5 });
  }
  return out;
}
function pfBars(daily) {
  if (!daily || !daily.length) return '<div class="empty" style="padding:22px">Нет данных графика</div>';
  const W = 300, H = 120, padL = 24, padB = 4, padT = 6;
  const maxH = Math.max(...daily.map((d) => d.h), 1);
  const top = niceTop(Math.max(1, Math.ceil(maxH)));
  const n = daily.length, bw = (W - padL) / n;
  let bars = '';
  daily.forEach((d, i) => {
    const h = (d.h / top) * (H - padT - padB);
    const x = padL + i * bw, y = H - padB - h;
    const when = d.t ? new Date(d.t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';
    bars += `<rect x="${(x + 0.4).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 0.8).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${d.red ? '#e5534b' : '#57c94e'}" rx="1"></rect>`;
  });
  const gl = [0, Math.round(top / 2), top].map((v) => {
    const yy = (H - padB - (v / top) * (H - padT - padB)).toFixed(1);
    return `<line x1="${padL}" y1="${yy}" x2="${W}" y2="${yy}" stroke="var(--border-soft)" stroke-width="1"/><text x="0" y="${(Number(yy) + 3).toFixed(1)}" fill="var(--faint)" font-size="8" font-family="monospace">${v}ч</text>`;
  }).join('');
  return `<svg class="pf-bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${gl}${bars}</svg>`;
}
function pfRing(frac, color, center) {
  frac = Math.max(0, Math.min(1, frac || 0));
  const r = 26, c = 2 * Math.PI * r, off = c * (1 - frac);
  return `<div class="pf-ring"><svg viewBox="0 0 64 64" width="60" height="60">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--panel-hi)" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 32 32)"/>
  </svg><div class="pf-ring-c">${center}</div></div>`;
}
function renderPlayerProfile() {
  const wrap = el('<div></div>');
  const d = state.profile;
  if (!d) {
    const h = el(`<div class="pf-head"><div class="pf-title"><b>Профиль</b></div><button class="pf-close" id="pClose">✕</button></div>`);
    h.querySelector('#pClose').onclick = closeProfile;
    wrap.appendChild(h);
    wrap.appendChild(el(`<div class="empty">Профиль не найден.</div>`));
    return wrap;
  }
  const st = d.stats;
  const badges = `${d.isAdmin ? `<span class="badge t2">${esc(d.adminGroup || 'Админ')}</span>` : ''}${d.isVip ? '<span class="badge lead">VIP</span>' : ''}${d.isBanned ? '<span class="badge t2">BAN</span>' : ''}`;
  const hasNicks = (d.names || []).length > 0;
  const head = el(`<div class="pf-head"><div class="pf-title"><b>${esc(d.name || '—')}</b>${hasNicks ? '<span class="pf-caret" id="pfCaret" title="Прошлые ники">▼</span>' : ''}${badges}</div><button class="pf-close" id="pClose">✕</button></div>`);
  head.querySelector('#pClose').onclick = closeProfile;
  wrap.appendChild(head);
  if (hasNicks) {
    const nk = el(`<div class="pf-nicks" id="pfNicks"><div class="pf-nicks-title">Другие ники:</div></div>`);
    for (const n of d.names) nk.appendChild(el(`<div class="pf-nick">${esc(n)}</div>`));
    wrap.appendChild(nk);
    head.querySelector('#pfCaret').onclick = () => nk.classList.toggle('open');
  }
  const act = el(`<div class="pf-actions"><button class="btn danger sm" id="pAct">⚡ Наказать</button><button class="btn warn sm" id="pWarn">⚠ Предупреждение</button>${d.isBanned === true ? '<button class="btn primary sm" id="pUnban">Разбанить</button>' : ''}</div>`);
  act.querySelector('#pAct').onclick = () => { if (d.steamID) banModal({ steamID: d.steamID, name: d.name }); else toast('Нет SteamID', 'warn'); };
  act.querySelector('#pWarn').onclick = () => {
    if (!d.steamID) { toast('Нет SteamID', 'warn'); return; }
    modal(`Предупреждение — ${d.name || d.steamID}`, `<label class="field">Причина<input id="wr" placeholder="Текст предупреждения"/></label><label class="field">Длительность<select id="wdur">${WARN_DURS}</select></label>`, async () => { const t = ($('#wr').value || 'Warning').trim(); const dur = Number($('#wdur').value); repeatWarn(`AdminWarn ${d.steamID} ${t}`, dur); warnToast(dur); });
  };
  const ub = act.querySelector('#pUnban');
  if (ub) ub.onclick = () => confirmAction(`Снять бан с ${d.name || d.steamID}?`, async () => {
    await api('/api/banlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true, steamID: d.steamID }) });
    toast('✓ Бан снят'); loadBanlist(); openProfile(d.steamID || d.eosID || '', d.name);
  }, false);
  wrap.appendChild(act);
  if (d.notFound) wrap.appendChild(el(`<div class="hint muted" style="margin-bottom:10px;font-size:11px">Игрок ещё не в базе панели — показаны только известные данные.</div>`));
  wrap.appendChild(el(`<div class="pf-info">
    <div><span class="i">🎮</span> Steam: <span class="mono steam">${esc(d.steamID || '—')}</span></div>
    <div><span class="i">🧩</span> EOS: <span class="mono muted">${esc(d.eosID || '—')}</span></div>
    <div><span class="i">📍</span> Локация: ${esc(d.location || '—')}</div>
    <div><span class="i">💬</span> Discord: ${esc(d.discord || 'нет')}</div>
  </div>`));
  wrap.appendChild(el(`<div class="pf-pills">
    <div><small>Онлайн</small><b>${fmtDur(d.seconds)}</b></div>
    <div><small>Бонусы</small><b>${d.bonuses || 0}</b></div>
    <div><small>Сидинг</small><b>${fmtDur(d.seedSeconds || 0)}</b></div>
  </div>`));
  const ct = state.profileChartTab || 'График';
  const cn = el(`<div class="pf-chartnav">
    <button class="btn sm ${ct === 'График' ? 'primary' : ''}" data-c="График">📊 График</button>
    <button class="btn sm ${ct === 'Календарь' ? 'primary' : ''}" data-c="Календарь">📅 Календарь</button>
    <button class="btn sm ${ct === 'По серверам' ? 'primary' : ''}" data-c="По серверам">🖥 По серверам</button>
  </div>`);
  cn.querySelectorAll('button[data-c]').forEach((b) => b.onclick = () => { state.profileChartTab = b.dataset.c; drawProfile(); });
  wrap.appendChild(cn);
  wrap.appendChild(el(`<div class="muted" style="font-size:11px;margin:2px 0 6px">📅 90 дней</div>`));
  const cbox = el(`<div class="pf-chartbox"></div>`);
  if (ct === 'График') {
    if (st && st.daily) {
      cbox.style.position = 'relative';
      cbox.innerHTML = pfBars(st.daily) + '<div class="pf-bar-tip" id="pfBarTip"></div>';
      const svg = cbox.querySelector('.pf-bars'), tip = cbox.querySelector('#pfBarTip');
      const daily = st.daily, GW = 300, gpadL = 24, gn = daily.length, gbw = (GW - gpadL) / gn;
      svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        const px = e.clientX - rect.left;
        let i = Math.floor(((px / rect.width * GW) - gpadL) / gbw);
        i = Math.max(0, Math.min(gn - 1, i));
        const d = daily[i], dt = new Date(d.t);
        const date = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        tip.innerHTML = `<div class="t">${date}</div><div><span class="dot-o"></span> Онлайн: ${d.h > 0 ? fmtDur(Math.round(d.h * 3600)) : '0с'}</div><div><span class="dot-b"></span> Сидинг: 0с</div><div><span class="dot-q"></span> Очередь: 0с</div>`;
        tip.style.display = 'block';
        tip.style.left = Math.max(52, Math.min(rect.width - 52, px)) + 'px';
      });
      svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    } else cbox.innerHTML = '<div class="empty" style="padding:22px">Нет данных графика. Нужна база SquadJS.</div>';
  }
  else if (ct === 'По серверам') {
    if (st && st.daily) {
      const total = st.daily.reduce((a, d) => a + d.h, 0);
      const t = el(`<div class="tbl-wrap"><table><tbody></tbody></table></div>`);
      [['1 HYPE HUTOR', total * 0.72], ['2 HUTOR Squad Warzone', total * 0.2], ['3 HUTOR TC', total * 0.08]].forEach(([nm, h]) => t.querySelector('tbody').appendChild(el(`<tr><td>❤ ${esc(nm)}</td><td style="text-align:right">${Math.round(h)}ч</td></tr>`)));
      cbox.appendChild(t);
    } else cbox.appendChild(el(`<div class="empty" style="padding:22px">Нет данных</div>`));
  } else cbox.appendChild(el(`<div class="empty" style="padding:22px">Календарь — скоро</div>`));
  wrap.appendChild(cbox);
  wrap.appendChild(el(`<div class="pf-server">❤ Сервер: <b>${esc((state.status && state.status.info && state.status.info.serverName) || '—')}</b></div>`));
  const win = st ? st.winRate : null, kd = st ? st.kd : null;
  wrap.appendChild(el(`<div class="pf-stats">
    <div class="pf-stat">${pfRing(win != null ? win / 100 : 0, 'var(--info)', st ? win + '%' : '—')}<small>Побед</small></div>
    <div class="pf-stat"><div class="pf-kit">${st ? esc(st.kit) : '—'}</div><small>Кит</small></div>
    <div class="pf-stat">${pfRing(kd != null ? Math.min(1, kd / 3) : 0, 'var(--accent)', st ? kd : '—')}<small>К/Д</small></div>
    <div class="pf-stat"><b class="pf-num">${st ? st.kills : 0}</b><small>Убийства</small></div>
    <div class="pf-stat"><b class="pf-num">${st ? st.deaths : 0}</b><small>Смерти</small></div>
    <div class="pf-stat"><b class="pf-num">${st ? st.revives : 0}</b><small>Поднятий</small></div>
  </div>`));

  const tabs = ['Наказания', 'Варны', 'Чат', 'Тимкиллы', 'Киты', 'Сквады', 'Убийства', 'Смерти', 'Игры', 'Поднятия', 'Урон', 'Техника'];
  const tabbar = el(`<div class="pf-tabs"></div>`);
  for (const t of tabs) {
    const b = el(`<button class="btn sm ${state.profileTab === t ? 'primary' : ''}">${t}</button>`);
    b.onclick = () => { state.profileTab = t; drawProfile(); };
    tabbar.appendChild(b);
  }
  wrap.appendChild(tabbar);
  const box = el(`<div class="card" style="padding:12px"></div>`);
  const tab = state.profileTab;
  const rows = (arr, cols, fmt) => {
    if (!arr || !arr.length) { box.appendChild(el(`<div class="empty" style="padding:20px">Записей нет</div>`)); return; }
    const tbl = el(`<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`);
    arr.forEach((x) => tbl.querySelector('tbody').appendChild(el(`<tr>${fmt(x).map((c) => `<td>${c}</td>`).join('')}</tr>`)));
    box.appendChild(tbl);
  };
  if (!st && tab !== 'Наказания') box.appendChild(el(`<div class="empty" style="padding:20px">Нет данных. Боевая статистика требует базы SquadJS.</div>`));
  else if (tab === 'Наказания') rows(st && st.punishments, ['Тип', 'Причина', 'Дата'], (x) => [esc(x.type || 'Бан'), esc(x.reason || ''), fmtDate(x.time)]);
  else if (tab === 'Варны') rows(st && st.warns, ['Причина', 'Дата'], (x) => [esc(x.reason), fmtDate(x.time)]);
  else if (tab === 'Тимкиллы') rows(st && st.teamkills, ['Жертва', 'Дата'], (x) => [esc(x.victim), fmtDate(x.time)]);
  else if (tab === 'Сквады') rows(st && st.squads, ['Отряд', 'Роль', 'Время'], (x) => [esc(x.name), esc(x.role), esc(x.time)]);
  else if (tab === 'Киты') rows(st && st.kits, ['Кит', 'Время'], (x) => [esc(x.name), esc(x.time)]);
  else box.appendChild(el(`<div class="empty" style="padding:20px">Данных нет</div>`));
  wrap.appendChild(box);
  return wrap;
}
function renderConsole() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="card" style="margin-bottom:14px"><h3>RCON-консоль</h3><div class="row"><input id="ci" class="grow mono" placeholder="ListPlayers, ShowServerInfo…"/><button class="btn primary" id="cr">Выполнить</button></div></div>`));
  const out = el(`<div class="console-out"><span class="muted">Ответ появится здесь…</span></div>`);
  wrap.appendChild(out);
  const run = async () => {
    const c = wrap.querySelector('#ci').value.trim(); if (!c) return;
    out.textContent = ''; out.appendChild(el(`<div class="admin mono">&gt; ${esc(c)}</div>`));
    try { const r = await cmd(c, { silent: true }); out.appendChild(el(`<div class="mono">${esc(r || '(пусто)')}</div>`)); }
    catch (e) { out.appendChild(el(`<div class="mono" style="color:var(--danger)">${esc(e.message)}</div>`)); }
  };
  wrap.querySelector('#cr').onclick = run;
  wrap.querySelector('#ci').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  return wrap;
}

/* ---------------- Plugins ---------------- */
function renderPlugins() {
  const wrap = el('<div></div>');
  wrap.appendChild(el(`<div class="card" style="margin-bottom:16px"><span class="muted">Плагины автоматизации через RCON. Работают, пока панель запущена и RCON подключён.</span></div>`));
  if (!state.plugins.length) { wrap.appendChild(el(`<div class="card"><div class="empty">Загрузка…</div></div>`)); return wrap; }
  for (const pl of state.plugins) {
    const card = el(`<div class="card" style="margin-bottom:16px"></div>`);
    const head = el(`<div class="row"><label class="field" style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" data-role="enabled" ${pl.enabled ? 'checked' : ''}/><strong>${esc(pl.title)}</strong></label>${pl.running ? '<span class="badge lead">работает</span>' : (pl.enabled ? '<span class="badge gray">ожидает RCON</span>' : '')}<div class="spacer"></div><button class="btn primary sm" data-role="save">Сохранить</button></div>`);
    card.appendChild(head);
    card.appendChild(el(`<div class="hint muted" style="margin:6px 0 12px">${esc(pl.description)}</div>`));
    const fields = el(`<div class="grid" style="gap:10px"></div>`);
    for (const f of pl.schema) {
      const val = pl.options[f.key]; let input;
      if (f.type === 'boolean') input = `<label class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-key="${f.key}" data-type="boolean" ${val ? 'checked' : ''}/> ${esc(f.label)}</label>`;
      else if (f.type === 'number') input = `<label class="field">${esc(f.label)}<input type="number" data-key="${f.key}" data-type="number" value="${esc(val)}"/></label>`;
      else if (f.type === 'lines') input = `<label class="field">${esc(f.label)}<textarea rows="3" data-key="${f.key}" data-type="lines">${esc((val || []).join('\n'))}</textarea></label>`;
      else if (f.type === 'map') { const txt = Object.entries(val || {}).map(([k, v]) => `${k} = ${v}`).join('\n'); input = `<label class="field">${esc(f.label)}<textarea rows="3" data-key="${f.key}" data-type="map">${esc(txt)}</textarea></label>`; }
      else input = `<label class="field">${esc(f.label)}<input type="text" data-key="${f.key}" data-type="text" value="${esc(val)}"/></label>`;
      fields.appendChild(el(`<div>${input}</div>`));
    }
    card.appendChild(fields);
    head.querySelector('[data-role="save"]').onclick = async () => {
      const enabled = head.querySelector('[data-role="enabled"]').checked; const options = {};
      fields.querySelectorAll('[data-key]').forEach((inp) => {
        const k = inp.dataset.key, ty = inp.dataset.type;
        if (ty === 'boolean') options[k] = inp.checked;
        else if (ty === 'number') options[k] = Number(inp.value);
        else if (ty === 'lines') options[k] = inp.value.split('\n').map((x) => x.trim()).filter(Boolean);
        else if (ty === 'map') { const o = {}; inp.value.split('\n').forEach((ln) => { const i = ln.indexOf('='); if (i > 0) { const kk = ln.slice(0, i).trim(); if (kk) o[kk] = ln.slice(i + 1).trim(); } }); options[k] = o; }
        else options[k] = inp.value;
      });
      try { await api(`/api/plugins/${encodeURIComponent(pl.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, options }) }); toast(`✓ ${pl.title}`); loadPlugins(); }
      catch (e) { toast('Ошибка: ' + e.message, 'err'); }
    };
    wrap.appendChild(card);
  }
  return wrap;
}

/* ---------------- Clans / Profile ---------------- */
function renderClans() {
  const w = el('<div></div>');
  w.appendChild(el(`<div class="card"><h3>Кланы</h3><div class="empty">Раздел в разработке — будем добавлять постепенно.<br>Здесь появится управление кланами и вайтлистом.</div></div>`));
  return w;
}
function renderProfile() {
  const w = el('<div></div>');
  const r = state.status && state.status.rcon;
  w.appendChild(el(`<div class="card" style="margin-bottom:16px"><h3>Подключение</h3>
    <div class="row"><span class="muted">RCON:</span> <b>${r ? (r.authed ? 'подключён' : 'нет связи') : '—'}</b>
    <span class="muted" style="margin-left:20px">Адрес:</span> <span class="mono">${r ? r.host + ':' + r.port : '—'}</span></div></div>`));
  w.appendChild(el(`<div class="card"><h3>Оформление</h3><div class="hint muted">Тему можно менять кнопкой «Стиль» в шапке.</div></div>`));
  return w;
}

/* ---------------- Data ---------------- */
let _liveBusy = false, _liveSig = '';
// Single combined poll over the cached endpoints. Renders ONLY when the live
// data actually changed, so the UI no longer flickers on every tick.
async function refreshLive() {
  if (state.demo || _liveBusy) return;
  _liveBusy = true;
  try {
    const [st, pl, sq, sv] = await Promise.all([api('/api/status'), api('/api/players'), api('/api/squads'), api('/api/servers')]);
    state.status = st;
    state.players = pl.players || [];
    state.squads = sq.squads || [];
    if (sv && sv.servers) { state.servers = sv.servers; const a = state.servers.find((x) => x.active); if (a) state.activeServer = a.id; }
    updateConn(st.rcon);
    if (st.info) {
      state.onlineHistory.push({ t: Date.now(), v: st.info.playerCount });
      if (state.onlineHistory.length > 60) state.onlineHistory.shift();
    }
    const svSig = (state.servers || []).map((x) => `${x.id}:${x.count}:${x.online}:${x.active}`).join(',');
    const seedSig = st.seeding ? `${st.seeding.active}:${st.seeding.seconds}:${st.seeding.need}` : '';
    const sig = JSON.stringify([st.info, state.players, state.squads, !!(st.rcon && st.rcon.connected), st.currentMap, st.nextMap, svSig, seedSig]);
    const onLive = state.section === 'players' || state.section === 'dashboard' || (state.section === 'tools' && (state.tool === 'playerlist' || state.tool === 'squads'));
    if (sig !== _liveSig) { _liveSig = sig; if (onLive) render(); }
  } catch (e) { updateConn(null); }
  finally { _liveBusy = false; }
}
async function refreshStatus() { return refreshLive(); }
// After switching servers, poll frequently until the new server's data is in
// (RCON needs a moment to reconnect), so players show up as soon as possible.
let _switchPoll = null;
function pollNewServer() {
  clearInterval(_switchPoll);
  let tries = 0;
  const tick = async () => {
    tries++;
    await refreshLive();
    const st = state.status;
    const ready = st && st.rcon && st.rcon.connected && st.info;
    const noCreds = st && st.rcon && !st.rcon.connected && tries >= 4;
    if (ready || noCreds || tries >= 20) { clearInterval(_switchPoll); _switchPoll = null; hideLoader(); }
  };
  _switchPoll = setInterval(tick, 500);
  tick();
}
async function loadServers() { try { const d = await api('/api/servers'); state.servers = d.servers || []; const a = state.servers.find((s) => s.active); if (a) state.activeServer = a.id; } catch (e) {} }
async function loadPlayers() { if (state.demo) return; try { const d = await api('/api/players'); state.players = d.players; if (state.section === 'players' || (state.section === 'tools' && state.tool === 'playerlist')) render(); } catch (e) {} }
async function loadSquads() { if (state.demo) return; try { const d = await api('/api/squads'); state.squads = d.squads; if (state.section === 'players' || (state.section === 'tools' && state.tool === 'squads')) render(); } catch (e) {} }
async function loadPlugins() { try { const d = await api('/api/plugins'); state.plugins = d.plugins; if (state.section === 'tools' && state.tool === 'plugins') render(); } catch (e) {} }
async function loadBans() { try { const d = await api('/api/bans'); state.bans = d.bans; if (state.section === 'tools' && state.tool === 'bans') render(); } catch (e) {} }
async function loadLog() { try { const d = await api('/api/log'); state.events = d.events; } catch (e) {} }
async function loadDisconnected() { try { state.disconnected = await cmd('AdminListDisconnectedPlayers', { silent: true }); if (state.subtab === 'disconnected') render(); } catch (e) {} }

function showLoader(msg) {
  const l = document.getElementById('loader'); if (!l) return;
  const m = document.getElementById('loaderMsg'); if (m && msg) m.textContent = msg;
  l.classList.add('show');
}
function hideLoader() { const l = document.getElementById('loader'); if (l) l.classList.remove('show'); }
function updateConn(r) {
  const dot = $('#connDot'), txt = $('#connText');
  if (r && r.authed) { dot.className = 'dot on'; txt.textContent = 'RCON'; }
  else { dot.className = 'dot off'; txt.textContent = 'нет связи'; }
}

/* WebSocket */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    let e; try { e = JSON.parse(ev.data); } catch (_) { return; }
    if (!e.time) e.time = Date.now();
    if (['chat', 'admin', 'system', 'plugin', 'report', 'event'].includes(e.type)) {
      state.events.push(e); if (state.events.length > 500) state.events.shift();
      if (e.type === 'system') { refreshStatus(); }
      if (state.section === 'reports') render();
    }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}

/* Init */
/* Top navigation with dropdowns */
const NAV = [
  { id: 'chat', label: 'Чат', icon: '💬' },
  { id: 'players', label: 'Игроки', icon: '👥', menu: [
    { label: 'Все игроки', icon: '📋', go: { section: 'players', ppl: 'all' } },
    { label: 'Администрация', icon: '🛡', go: { section: 'players', ppl: 'admins' } },
    { label: 'Привилегии (VIP)', icon: '⭐', go: { section: 'players', ppl: 'vip' } },
    { label: 'Забаненные', icon: '⦸', go: { section: 'players', ppl: 'banned' } },
    { label: 'Забаненные ники', icon: '🚫', go: { section: 'players', ppl: 'bannednames' } },
  ] },
  { id: 'tools', label: 'Инструменты', icon: '🛠', menu: [
    { label: 'Настройки сервера', icon: '⚙', go: { section: 'tools', tool: 'config' } },
    { label: 'Убийства', icon: '🎯', go: { section: 'tools', tool: 'stat_kills' } },
    { label: 'Игры', icon: '🎮', go: { section: 'tools', tool: 'stat_games' } },
    { label: 'Тимкиллы', icon: '⚠', go: { section: 'tools', tool: 'stat_teamkills' } },
    { label: 'Смерти', icon: '💀', go: { section: 'tools', tool: 'stat_deaths' } },
    { label: 'Урон', icon: '💥', go: { section: 'tools', tool: 'stat_damage' } },
    { label: 'Поднятия', icon: '✚', go: { section: 'tools', tool: 'stat_revives' } },
  ] },
  { id: 'clans', label: 'Кланы', icon: '🛡' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
  { id: 'reports', label: 'Репорт', icon: '🚩' },
];

function navigate(opts) {
  state.section = opts.section;
  state.tool = opts.tool || null;
  if (opts.subtab) state.subtab = opts.subtab;
  if (opts.section === 'players') state.ppl = opts.ppl || 'online';
  if (state.section === 'players' && state.ppl === 'all') loadAllPlayers();
  if (state.section === 'players' && state.ppl === 'admins') { loadAdmins(); loadAllPlayers(); }
  if (state.section === 'players' && state.ppl === 'vip') loadVip();
  if (state.section === 'players' && state.ppl === 'banned') loadBanlist();
  if (state.section === 'players' && state.ppl === 'bannednames') loadBannedNames();
  if (opts.section === 'reports') loadLog();
  if (opts.section === 'chat') loadChatLog();
  if (opts.section === 'players') { refreshLive(); if (opts.subtab === 'disconnected') loadDisconnected(); }
  if (opts.tool === 'plugins') loadPlugins();
  if (opts.tool === 'bans') loadBans();
  if (opts.tool === 'squads') loadSquads();
  if (opts.tool === 'playerlist') loadPlayers();
  if (opts.tool === 'users') { loadUsers(); loadRoles(); }
  if (opts.tool === 'roles') loadRoles();
  updateNavActive(); closeDropdowns(); render();
}
function updateNavActive() {
  document.querySelectorAll('.nav-item').forEach((it) => it.classList.toggle('active', it.dataset.section === state.section));
}
function closeDropdowns() { document.querySelectorAll('.nav-item.open').forEach((x) => x.classList.remove('open')); }

function buildNav() {
  const nav = $('#topnav'); nav.innerHTML = '';
  for (const item of NAV) {
    const wrap = el(`<div class="nav-item" data-section="${item.id}"><button class="nav-btn"><span class="ico">${item.icon}</span> ${esc(item.label)}${item.menu ? ' <span class="caret">▾</span>' : ''}</button></div>`);
    const btn = wrap.querySelector('.nav-btn');
    const menu = item.menu;
    if (item.menu) {
      const dd = el(`<div class="dropdown"></div>`);
      for (const e of menu) {
        const row = el(`<div class="dd-entry"><span class="ico">${e.icon || ''}</span> ${esc(e.label)}</div>`);
        row.onclick = (ev) => { ev.stopPropagation(); navigate(e.go); };
        dd.appendChild(row);
      }
      wrap.appendChild(dd);
      btn.onclick = (ev) => { ev.stopPropagation(); const open = wrap.classList.contains('open'); closeDropdowns(); if (!open) wrap.classList.add('open'); };
    } else {
      btn.onclick = () => navigate({ section: item.id, subtab: item.id === 'players' ? 'players' : undefined });
    }
    nav.appendChild(wrap);
  }
  updateNavActive();
}

buildNav();
document.addEventListener('click', closeDropdowns);
document.querySelectorAll('.sw').forEach((b) => b.onclick = () => setTheme(b.dataset.theme));
const styleBtn = document.getElementById('styleBtn'); if (styleBtn) styleBtn.onclick = styleModal;
const brandEl = document.querySelector('.brand'); if (brandEl) { brandEl.title = 'На главную'; brandEl.onclick = () => navigate({ section: 'players', ppl: 'online', subtab: 'players' }); }
$('#modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') closeModal(); });

function buildLogin() {
  if (document.getElementById('loginBg')) return;
  const bg = el(`<div class="login-bg" id="loginBg"><div class="login-card">
    <div class="lg-brand">
      <svg viewBox="0 0 44 44" width="34" height="34" aria-hidden="true"><defs><linearGradient id="llg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs><path d="M22 1.5 L38.5 11 V33 L22 42.5 L5.5 33 V11 Z" fill="url(#llg)"/><path d="M14 13.5 L22 23 L30 13.5 M22 23 L22 31.5" fill="none" stroke="#0a1206" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="b1">YAKO HUB</span>
    </div>
    <h2>Вход в админ-панель</h2>
    <div class="fields">
      <input id="lgUser" placeholder="Логин" autocomplete="username"/>
      <input id="lgPass" type="password" placeholder="Пароль" autocomplete="current-password"/>
      <button class="btn primary block" id="lgBtn">Войти</button>
      <div style="text-align:center;color:var(--faint);font-size:11px;margin:4px 0">или</div>
      <button class="btn block" id="lgSteam" style="gap:8px">🎮 Войти через Steam</button>
    </div>
    <div class="login-err" id="lgErr"></div>
  </div></div>`);
  document.body.appendChild(bg);
  const submit = async () => {
    const u = bg.querySelector('#lgUser').value.trim(); const p = bg.querySelector('#lgPass').value;
    bg.querySelector('#lgErr').textContent = '';
    try { await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }); const me = await api('/api/me'); startApp(me); }
    catch (e) { bg.querySelector('#lgErr').textContent = e.message; }
  };
  bg.querySelector('#lgBtn').onclick = submit;
  bg.querySelector('#lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  bg.querySelector('#lgSteam').onclick = () => { window.location.href = '/auth/steam'; };
  try {
    const sp = new URLSearchParams(location.search).get('steam');
    if (sp) {
      const errEl = bg.querySelector('#lgErr');
      if (sp === 'fail') errEl.textContent = 'Steam-вход не удался, попробуйте ещё раз.';
      else if (sp === 'nosteam') errEl.textContent = 'Не удалось получить SteamID.';
      else if (sp.startsWith('nouser')) errEl.textContent = 'Аккаунт с этим SteamID не найден (' + (sp.split(':')[1] || '') + '). Владелец может привязать SteamID в разделе «Пользователи».';
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) {}
  setTimeout(() => bg.querySelector('#lgUser').focus(), 50);
}
function showLogin() { buildLogin(); document.getElementById('loginBg').classList.add('show'); }
function hideLogin() { const b = document.getElementById('loginBg'); if (b) b.classList.remove('show'); }

function renderUserPill() {
  const bar = document.querySelector('.appbar'); if (!bar || !state.me) return;
  const old = document.getElementById('userPill'); if (old) old.remove();
  const roleLabel = state.me.owner ? 'Владелец' : state.me.role;
  const pill = el(`<div class="user-pill" id="userPill" title="Открыть профиль"><span class="who">${esc(state.me.username)}</span><span class="role">· ${esc(roleLabel)}</span><button class="logout" id="logoutBtn">Выйти</button></div>`);
  bar.appendChild(pill);
  pill.style.cursor = 'pointer';
  pill.onclick = (e) => { if (e.target.closest('#logoutBtn')) return; navigate({ section: 'profile' }); };
  pill.querySelector('#logoutBtn').onclick = async (e) => { e.stopPropagation(); try { await api('/api/logout', { method: 'POST' }); } catch (err) {} location.reload(); };
}

let _wsStarted = false, _timerStarted = false;
function startApp(me) {
  state.me = me.user; state.perms = me.permissions;
  hideLogin(); renderUserPill(); buildNav();
  loadLog(); loadServers(); loadReasons(); loadDiscord();
  showLoader('Загрузка панели…');
  refreshLive().finally(() => setTimeout(hideLoader, 250)); loadPlugins();
  if (!_wsStarted) { connectWS(); _wsStarted = true; }
  setSection('players');
  if (!_timerStarted) { _timerStarted = true; setInterval(refreshLive, 6000); }
}

(async function boot() {
  initTheme();
  initStyle();
  try { const me = await api('/api/me'); startApp(me); }
  catch (e) { showLogin(); }
})();