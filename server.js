'use strict';

/**
 * Squad Admin Panel — backend.
 *
 * Zero external dependencies: uses only Node.js built-ins (net, http, crypto,
 * fs). Talks to your Squad server over RCON (see rcon.js) and exposes a small
 * REST + WebSocket API that the web UI in ./public consumes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { SquadRcon, parsePlayers, parseSquads, parseServerInfo, parseCurrentMap, parseNextMap } = require('./rcon');
const { PluginEngine } = require('./plugins');
const { Store } = require('./store');
const { Auth } = require('./auth');

/* --------------------------- Configuration --------------------------- */

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('Could not parse config.json:', e.message);
      process.exit(1);
    }
  }
  return {
    rconHost: process.env.SQUAD_RCON_HOST || cfg.rconHost || '127.0.0.1',
    rconPort: Number(process.env.SQUAD_RCON_PORT || cfg.rconPort || 21114),
    rconPassword: process.env.SQUAD_RCON_PASSWORD || cfg.rconPassword || '',
    webHost: process.env.PANEL_HOST || cfg.webHost || '127.0.0.1',
    webPort: Number(process.env.PANEL_PORT || cfg.webPort || 3000),
    // Optional HTTP Basic auth for the panel itself.
    panelUser: process.env.PANEL_USER || cfg.panelUser || '',
    panelPassword: process.env.PANEL_PASSWORD || cfg.panelPassword || '',
    servers: Array.isArray(cfg.servers) ? cfg.servers : null,
    owner: cfg.owner || null,
    adminsFilePath: process.env.SQUAD_ADMINS_CFG || cfg.adminsFilePath || null,
    bansFilePath: process.env.SQUAD_BANS_CFG || cfg.bansFilePath || null,
  };
}

const config = loadConfig();

if (!config.rconPassword) {
  console.warn('\n[!] No RCON password set. Edit config.json (rconPassword) before connecting.\n');
}

/* ------------------------------ State ------------------------------ */

const rcon = new SquadRcon({
  host: config.rconHost,
  port: config.rconPort,
  password: config.rconPassword,
});

const DATA_DIR = path.join(__dirname, 'data');
const CHATLOG_FILE = path.join(DATA_DIR, 'chatlog.json');
const eventLog = [];        // live buffer (all event types)
const bansIssued = [];      // bans issued through this panel (in-memory)
const MAX_LOG = 1000;
const MAX_CHATLOG = 5000;

// Persistent chat/report history (survives restarts).
let chatHistory = [];
try { if (fs.existsSync(CHATLOG_FILE)) chatHistory = JSON.parse(fs.readFileSync(CHATLOG_FILE, 'utf8')); } catch (e) {}
for (const e of chatHistory.slice(-MAX_LOG)) eventLog.push(e); // preload so the Чат tab shows history
let _chatDirty = false;
const _chatTimer = setInterval(() => {
  if (!_chatDirty) return;
  _chatDirty = false;
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CHATLOG_FILE, JSON.stringify(chatHistory.slice(-MAX_CHATLOG))); } catch (e) {}
}, 3000);
if (_chatTimer.unref) _chatTimer.unref();

function pushEvent(evt) {
  const withTime = { ...evt, time: Date.now() };
  eventLog.push(withTime);
  if (eventLog.length > MAX_LOG) eventLog.shift();
  if (evt.type === 'chat' || evt.type === 'report') {
    chatHistory.push(withTime);
    if (chatHistory.length > MAX_CHATLOG) chatHistory.shift();
    _chatDirty = true;
  }
  broadcast(withTime);
}

const store = new Store({ adminsFilePath: config.adminsFilePath, bansFilePath: config.bansFilePath });
const auth = new Auth({ owner: config.owner });
const pluginEngine = new PluginEngine({ rcon, onLog: pushEvent, store });

/* ------------------------- Server registry (live add/switch) ------------------------- */
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
let servers = loadServers();
function loadServers() {
  try { if (fs.existsSync(SERVERS_FILE)) return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8')); } catch (e) {}
  const base = (Array.isArray(config.servers) && config.servers.length) ? config.servers : [{ id: 1, name: config.rconHost + ':' + config.rconPort }];
  const seeded = base.map((sv, i) => ({
    id: sv.id != null ? sv.id : i + 1,
    name: sv.name || ('Server ' + (i + 1)),
    host: i === 0 ? (sv.host || config.rconHost) : (sv.host || ''),
    port: i === 0 ? (sv.port || config.rconPort) : (sv.port || ''),
    password: i === 0 ? (sv.password || config.rconPassword) : (sv.password || ''),
    active: i === 0,
  }));
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SERVERS_FILE, JSON.stringify(seeded, null, 2)); } catch (e) {}
  return seeded;
}
function saveServers() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2)); } catch (e) {} }

// ---- Punishment reasons (owner-editable, shown in the punish dialog) ----
const REASONS_FILE = path.join(DATA_DIR, 'reasons.json');
let punishReasons = loadReasons();
function loadReasons() {
  try { if (fs.existsSync(REASONS_FILE)) { const a = JSON.parse(fs.readFileSync(REASONS_FILE, 'utf8')); if (Array.isArray(a)) return a; } } catch (e) {}
  const def = ['Читы / запрещённый софт', 'Тимкилл', 'Оскорбления / токсичность', 'Слив базы / гриферство', 'Нарушение правил отряда', 'Реклама / спам', 'AFK / бездействие', 'Неадекватное поведение'];
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(REASONS_FILE, JSON.stringify(def, null, 2)); } catch (e) {}
  return def;
}
function saveReasons() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(REASONS_FILE, JSON.stringify(punishReasons, null, 2)); } catch (e) {} }

// ---- Discord webhook notifications (bans / kicks / banned nicks) ----
const DISCORD_FILE = path.join(DATA_DIR, 'discord.json');
let discordCfg = loadDiscord();
function loadDiscord() {
  try { if (fs.existsSync(DISCORD_FILE)) { const c = JSON.parse(fs.readFileSync(DISCORD_FILE, 'utf8')); if (c && typeof c === 'object') return { webhook: c.webhook || '', enabled: !!c.enabled }; } } catch (e) {}
  return { webhook: '', enabled: false };
}
function saveDiscord() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DISCORD_FILE, JSON.stringify(discordCfg, null, 2)); } catch (e) {} }
const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'];
function discordPost(webhook, content) {
  return new Promise((resolve) => {
    if (!webhook) return resolve({ ok: false, error: 'webhook не задан' });
    if (!content) return resolve({ ok: false, error: 'пустое сообщение' });
    let u; try { u = new URL(webhook); } catch (e) { return resolve({ ok: false, error: 'неверный URL' }); }
    if (!DISCORD_HOSTS.includes(u.hostname)) return resolve({ ok: false, error: 'это не Discord webhook (нужен https://discord.com/api/webhooks/...)' });
    const body = JSON.stringify({ content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } });
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const rq = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 8000 }, (r) => {
        let data = ''; r.on('data', (c) => { data += c; }); r.on('end', () => fin({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, error: (r.statusCode >= 200 && r.statusCode < 300) ? null : ('Discord ответил ' + r.statusCode + (data ? ': ' + data.slice(0, 160) : '')) }));
      });
      rq.on('error', (e) => fin({ ok: false, error: 'сеть: ' + e.message }));
      rq.on('timeout', () => { rq.destroy(); fin({ ok: false, error: 'таймаут соединения с Discord' }); });
      rq.write(body); rq.end();
    } catch (e) { fin({ ok: false, error: e.message }); }
  });
}
// Fire-and-forget for automatic notifications (respects the enabled toggle).
function discordSend(content) { if (!discordCfg.enabled || !discordCfg.webhook) return; discordPost(discordCfg.webhook, content).catch(() => {}); }
function banDurLabel(d) {
  d = String(d == null ? '0' : d);
  if (d === '0' || d === '') return 'навсегда';
  const m = d.match(/^(\d+)\s*([hdMy])$/);
  if (!m) return d;
  const unit = { h: 'ч.', d: 'дн.', M: 'мес.', y: 'г.' }[m[2]] || '';
  return `${m[1]} ${unit}`;
}
function _discTarget(token) {
  if (/^\d{17}$/.test(token)) { const p = snapshot.players.find((x) => x.steamID === token); return { name: p ? p.name : '', steamID: token }; }
  const p = snapshot.players.find((x) => String(x.id) === String(token)); return { name: p ? p.name : '', steamID: p ? p.steamID : token };
}
function notifyCommandPunish(user, command) {
  const server = (activeServer() || {}).name || 'Server';
  let m;
  if ((m = command.match(/^AdminKick(?:ById)?\s+(\S+)\s+([\s\S]+)$/i))) {
    const t = _discTarget(m[1]);
    discordSend(`**${server}** — ${user} кикнул **${t.name || m[1]}** (${t.steamID || m[1]}) по причине: *${m[2].trim()}*`);
  } else if ((m = command.match(/^AdminBan(?:ById)?\s+(\S+)\s+(\S+)\s+([\s\S]+)$/i))) {
    const t = _discTarget(m[1]);
    discordSend(`**${server}** — ${user} ЗАБАНИЛ **${t.name || m[1]}** (${t.steamID || m[1]}) на ${banDurLabel(m[2])} по причине: *${m[3].trim()}*`);
  }
}
function activeServer() { return servers.find((s) => s.active) || servers[0] || null; }
const serverCounts = {}; // id -> { count, max, online, at }
function publicServers() {
  const act = activeServer();
  return servers.map((s) => {
    let count = null, max = null, online = false;
    if (act && s.id === act.id) {
      if (snapshot && snapshot.info) { count = snapshot.info.playerCount; max = snapshot.info.maxPlayers; online = true; }
      else if (rcon.authed) online = true;
    } else {
      const c = serverCounts[s.id];
      if (c) { count = (c.count != null ? c.count : null); max = c.max != null ? c.max : null; online = !!c.online; }
    }
    return { id: s.id, name: s.name, host: s.host || '', port: s.port || '', active: !!s.active, hasPassword: !!s.password, count, max, online };
  });
}
function applyActiveServer() {
  const s = activeServer();
  clearSnapshot(); // drop cached stats so we never show another server's data after a switch
  if (s && s.host && s.port && s.password) {
    rcon.reconfigure({ host: s.host, port: s.port, password: s.password });
  } else {
    // active server has no RCON credentials -> disconnect instead of keeping the old server's data
    try { rcon.close(); } catch (e) {}
  }
  setTimeout(() => { try { pollAllServerCounts(); } catch (e) {} }, 1500);
}

// Backend polls RCON on a timer and caches a consistent snapshot. HTTP
// endpoints serve this cache instantly (no RCON per request), which prevents
// request pile-ups on the single RCON socket and the UI flicker they caused.
const SEED_THRESHOLD = 50; // server is "seeding" until it reaches this many players
let snapshot = { at: 0, info: null, currentMap: null, nextMap: null, players: [], squads: [] };
let seedingSince = null; // timestamp the server dropped below SEED_THRESHOLD (null = live/unknown)
function clearSnapshot() { snapshot = { at: 0, info: null, currentMap: null, nextMap: null, players: [], squads: [] }; seedingSince = null; }
let _snapBusy = false;
async function refreshSnapshot() {
  if (!rcon.authed || _snapBusy) return;
  _snapBusy = true;
  try {
    const si = await rcon.execute('ShowServerInfo').catch(() => '');
    const cm = await rcon.execute('ShowCurrentMap').catch(() => '');
    const nm = await rcon.execute('ShowNextMap').catch(() => '');
    const lp = await rcon.execute('ListPlayers').catch(() => '');
    const ls = await rcon.execute('ListSquads').catch(() => '');
    const players = parsePlayers(lp);
    const squads = parseSquads(ls);
    snapshot = { at: Date.now(), info: parseServerInfo(si), currentMap: parseCurrentMap(cm), nextMap: parseNextMap(nm), players, squads };
    if (players.length) store.recordOnline(players, 8, (snapshot.info && snapshot.info.playerCount < SEED_THRESHOLD));
    const _pc = snapshot.info ? snapshot.info.playerCount : null;
    if (_pc != null) { if (_pc >= SEED_THRESHOLD) seedingSince = null; else if (seedingSince == null) seedingSince = Date.now(); }
    const _seedingNow = _pc != null && _pc < SEED_THRESHOLD;
  } catch (e) { /* ignore */ } finally { _snapBusy = false; }
}
const _snapTimer = setInterval(refreshSnapshot, 8000);
if (_snapTimer.unref) _snapTimer.unref();
rcon.on('ready', () => { refreshSnapshot(); });

// Poll player counts of the NON-active servers (those with credentials) so every
// server tab shows its own online, not just the active one.
function pollServerCount(sv) {
  return new Promise((resolve) => {
    if (!sv.host || !sv.port || !sv.password) { serverCounts[sv.id] = { online: false, at: Date.now() }; return resolve(); }
    let finished = false;
    const r = new SquadRcon({ host: sv.host, port: Number(sv.port), password: String(sv.password), autoReconnect: false });
    const done = (data) => { if (finished) return; finished = true; clearTimeout(to); try { r.close(); } catch (e) {} try { if (r.client) r.client.destroy(); } catch (e) {} serverCounts[sv.id] = Object.assign({ at: Date.now() }, data); resolve(); };
    const to = setTimeout(() => done({ online: false }), 8000);
    r.connect().then(async () => {
      const si = await r.execute('ShowServerInfo').catch(() => '');
      const info = parseServerInfo(si);
      done({ count: info ? info.playerCount : null, max: info ? info.maxPlayers : null, online: !!info });
    }).catch(() => done({ online: false }));
  });
}
async function pollAllServerCounts() {
  const act = activeServer();
  for (const sv of servers) {
    if (act && sv.id === act.id) continue; // active handled by the main snapshot
    await pollServerCount(sv);
  }
}
const _countsTimer = setInterval(pollAllServerCounts, 30000);
if (_countsTimer.unref) _countsTimer.unref();
setTimeout(pollAllServerCounts, 3000);

rcon.on('ready', () => {
  console.log(`[rcon] connected & authenticated to ${config.rconHost}:${config.rconPort}`);
  pushEvent({ type: 'system', message: 'RCON connected' });
  pluginEngine.onRconReady();
});
rcon.on('close', () => {
  console.log('[rcon] connection closed');
  pushEvent({ type: 'system', message: 'RCON disconnected' });
});
rcon.on('error', (err) => console.error('[rcon] error:', err.message));
rcon.on('chat', (parsed) => {
  pushEvent({ type: 'chat', ...parsed });
});
rcon.on('event', (e) => {
  pushEvent({ type: e.event === 'SERVER' ? 'system' : 'event', ...e });
});

applyActiveServer();
if (!rcon.connected) rcon.connect().catch((e) => console.error('[rcon] initial connect failed:', e.message));

/* --------------------------- HTTP helpers --------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function checkAuth(req) {
  if (!config.panelUser) return true;
  const header = req.headers['authorization'] || '';
  const expected = 'Basic ' + Buffer.from(`${config.panelUser}:${config.panelPassword}`).toString('base64');
  return header === expected;
}

/* ------------------------------ Routes ------------------------------ */

const PROFANITY = /(бля|хуй|ху[её]|пизд|[её]б[аул]|заеб|уеб|въеб|на[её]б|сук[аи]|мудак|мудил|пид[оа]р|г[оа]ндон|манд[ауы]|дроч|залуп|\bхер)/i;

function demoProfile() {
  const now = Date.now();
  return {
    name: 'MZeca09', steamID: '76561199124027762', eosID: '00023b7e77444c25b9f045c833196097', discord: '',
    firstSeen: now - 90 * 864e5, lastSeen: now - 3600e3, seconds: 14 * 60, names: ['MZeca09', 'Zeca'],
    isAdmin: false, adminGroup: null, isVip: true, isBanned: false,
    location: 'Португалия — Порту', bonuses: 54, boostSeconds: 14 * 60,
    stats: {
      winRate: 47, kit: 'LAT', kd: 1.32, kills: 842, deaths: 637, revives: 311,
      daily: (function(){ const o=[]; for(let i=89;i>=0;i--){ const b=Math.random(); let h=b<0.4?0:b<0.8?Math.random()*3:3+Math.random()*8; h=Math.round(h*10)/10; o.push({ t: now - i*864e5, h, red: h>6 && Math.random()<0.5 }); } return o; })(),
      warns: [{ time: now - 2 * 864e5, reason: 'Спам в чат' }],
      teamkills: [{ time: now - 864e5, victim: 'Ivan' }],
      squads: [{ name: 'ASSAULT', role: 'SL', time: '2ч 14м' }],
      kits: [{ name: 'LAT', time: '40ч' }, { name: 'Medic', time: '12ч' }],
      punishments: [],
    },
  };
}

function steamVerify(body) {
  return new Promise((resolve) => {
    const r = https.request({ hostname: 'steamcommunity.com', path: '/openid/login', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (resp) => {
      let d = ''; resp.on('data', (c) => (d += c)); resp.on('end', () => resolve(/is_valid\s*:\s*true/i.test(d)));
    });
    r.on('error', () => resolve(false));
    r.write(body); r.end();
  });
}

function getCookie(req, name) {
  const c = req.headers.cookie || '';
  for (const part of c.split(';')) { const idx = part.indexOf('='); const k = part.slice(0, idx).trim(); if (k === name) return decodeURIComponent(part.slice(idx + 1).trim()); }
  return null;
}
function commandPerm(cmd) {
  if (/^(List|Show)/i.test(cmd) || /^AdminListDisconnectedPlayers/i.test(cmd)) return null; // reads: any authed
  if (/^(AdminBroadcast|ChatToAdmin|AdminWarn)/i.test(cmd)) return 'chat';
  if (/^AdminBan(ById)?\b/i.test(cmd)) return 'ban';
  if (/^AdminKick(ById)?\b/i.test(cmd)) return 'kick';
  if (/^AdminForceTeamChange/i.test(cmd)) return 'forceteamchange';
  if (/^(AdminRemovePlayerFromSquad|AdminDisbandSquad|AdminDemoteCommander)/i.test(cmd)) return 'kick';
  if (/^(AdminChangeLayer|AdminSetNextLayer|AdminRestartMatch|AdminEndMatch)\b/i.test(cmd)) return 'changemap';
  if (/^(AdminPauseMatch|AdminUnpauseMatch)\b/i.test(cmd)) return 'pause';
  if (/^Admin(Set|Slomo|DisableVehicleClaiming)/i.test(cmd)) return 'config';
  return 'config';
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const token = auth.login(b.username, b.password);
    if (!token) return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `yako_sess=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax` });
    return res.end(JSON.stringify({ ok: true }));
  }

  const sess = auth.session(getCookie(req, 'yako_sess'));
  if (!sess) return sendJSON(res, 401, { error: 'Требуется вход' });
  const deny = () => sendJSON(res, 403, { error: 'Недостаточно прав' });

  if (p === '/api/logout' && req.method === 'POST') {
    auth.logout(getCookie(req, 'yako_sess'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'yako_sess=; HttpOnly; Path=/; Max-Age=0' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (p === '/api/me' && req.method === 'GET') {
    return sendJSON(res, 200, { user: { username: sess.username, role: sess.role, owner: auth.isOwner(sess.username) }, permissions: auth.permsFor(sess.username) });
  }
  if (p === '/api/testchat' && req.method === 'POST') {
    const b = await readBody(req);
    pushEvent({ type: 'chat', channel: 'ChatAll', name: (b && b.name) || 'YAKO HUB', steamID: (b && b.steamID) || '', eosID: (b && b.eosID) || '', message: (b && b.message) || 'Тестовое сообщение — чат работает ✅' });
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/chatlog' && req.method === 'GET') {
    const q = url.searchParams;
    const text = (q.get('query') || '').toLowerCase();
    const name = (q.get('name') || '').toLowerCase();
    const channel = q.get('channel') || '';
    const from = q.get('from') ? Date.parse(q.get('from')) : null;
    const to = q.get('to') ? Date.parse(q.get('to')) + 86400000 : null;
    const onlyProf = q.get('profanity') === '1';
    const page = Math.max(1, parseInt(q.get('page') || '1', 10));
    const pageSize = Math.min(200, Math.max(10, parseInt(q.get('pageSize') || '50', 10)));
    let list = chatHistory.filter((e) => e.type === 'chat');
    if (text) list = list.filter((e) => (e.message || '').toLowerCase().includes(text));
    if (name) list = list.filter((e) => (e.name || '').toLowerCase().includes(name) || (e.steamID || '').includes(name));
    if (channel) list = list.filter((e) => e.channel === channel);
    if (from) list = list.filter((e) => e.time >= from);
    if (to) list = list.filter((e) => e.time <= to);
    if (onlyProf) list = list.filter((e) => PROFANITY.test(e.message || ''));
    list = list.slice().reverse(); // newest first
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const events = list.slice((page - 1) * pageSize, page * pageSize)
      .map((e) => ({ ...e, profanity: PROFANITY.test(e.message || '') }));
    return sendJSON(res, 200, { events, total, page, pages, pageSize });
  }
  if (p === '/api/users') {
    if (!auth.isOwner(sess.username)) return deny();
    if (req.method === 'GET') return sendJSON(res, 200, { users: auth.listUsers() });
    if (req.method === 'POST') {
      const b = await readBody(req);
      try {
        if (b.op === 'remove') auth.removeUser(b.username);
        else if (b.op === 'update') auth.updateUser(b.username, { role: b.role, disabled: b.disabled, password: b.password, steamID: b.steamID });
        else auth.createUser({ username: b.username, password: b.password, role: b.role, steamID: b.steamID });
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
  }
  if (p === '/api/roles') {
    if (req.method === 'GET') {
      const { PERM_KEYS, PERM_LABELS, PERM_WARN } = require('./auth');
      return sendJSON(res, 200, { roles: auth.listRoles(), permKeys: PERM_KEYS, permLabels: PERM_LABELS, permWarn: PERM_WARN });
    }
    if (!auth.isOwner(sess.username)) return deny();
    if (req.method === 'POST') {
      const b = await readBody(req);
      try { if (b.op === 'remove') auth.removeRole(b.name); else auth.upsertRole({ name: b.name, permissions: b.permissions }); return sendJSON(res, 200, { ok: true }); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
  }

  if (p === '/api/health') {
    return sendJSON(res, 200, { ok: true, rcon: rcon.status });
  }

  if (p === '/api/status' && req.method === 'GET') {
    const _pc = snapshot.info ? snapshot.info.playerCount : null;
    const seeding = { threshold: SEED_THRESHOLD, active: _pc != null && _pc < SEED_THRESHOLD, seconds: seedingSince ? Math.floor((Date.now() - seedingSince) / 1000) : 0, need: (_pc != null ? Math.max(0, SEED_THRESHOLD - _pc) : null) };
    return sendJSON(res, 200, { rcon: rcon.status, info: snapshot.info, currentMap: snapshot.currentMap, nextMap: snapshot.nextMap, snapshotAt: snapshot.at, seeding });
  }

  if (p === '/api/players' && req.method === 'GET') {
    return sendJSON(res, 200, { players: snapshot.players });
  }

  if (p === '/api/squads' && req.method === 'GET') {
    return sendJSON(res, 200, { squads: snapshot.squads });
  }

  if (p === '/api/log' && req.method === 'GET') {
    return sendJSON(res, 200, { events: eventLog });
  }

  if (p === '/api/bans' && req.method === 'GET') {
    return sendJSON(res, 200, { bans: bansIssued });
  }

  if (p === '/api/command' && req.method === 'POST') {
    const body = await readBody(req);
    const command = (body.command || '').trim();
    if (!command) return sendJSON(res, 400, { error: 'command required' });
    { const _cp = commandPerm(command); if (_cp && !auth.can(sess.username, _cp)) return deny(); }
    try {
      const response = await rcon.execute(command);
      // Log admin-relevant actions
      if (/^Admin/i.test(command)) {
        pushEvent({ type: 'admin', command, user: sess.username, response: response.slice(0, 400) });
      }
      if (/^AdminBan(ById)?/i.test(command)) {
        bansIssued.push({ command, response, time: Date.now() });
      }
      if (/^Admin(Kick|Ban)/i.test(command)) { try { notifyCommandPunish(sess.username, command); } catch (e) {} }
      return sendJSON(res, 200, { response });
    } catch (e) {
      return sendJSON(res, 503, { error: e.message });
    }
  }

  if (p === '/api/player' && req.method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (key === 'demo') return sendJSON(res, 200, { profile: demoProfile() });
    const rec = store.getPlayer(key);
    if (!rec) return sendJSON(res, 200, { profile: null });
    const adminRec = store.listAdmins().find((a) => a.steamID === rec.steamID) || null;
    const vipRec = store.listVip().find((v) => v.steamID === rec.steamID) || null;
    const banned = store.listBans().some((b) => b.steamID === rec.steamID);
    return sendJSON(res, 200, { profile: {
      name: rec.name, steamID: rec.steamID, eosID: rec.eosID, discord: rec.discord || '',
      firstSeen: rec.firstSeen, lastSeen: rec.lastSeen, seconds: rec.seconds, seedSeconds: rec.seedSeconds || 0, names: rec.names || [],
      isAdmin: !!adminRec, adminGroup: adminRec ? adminRec.group : null, isVip: !!vipRec, isBanned: banned,
      location: null, bonuses: 0, boostSeconds: 0, stats: null,
    } });
  }

  if (p === '/api/allplayers' && req.method === 'GET') {
    const q = url.searchParams;
    const from = q.get('from') ? Date.parse(q.get('from')) : null;
    const to = q.get('to') ? Date.parse(q.get('to')) + 86400000 : null;
    return sendJSON(res, 200, { players: store.getAllPlayers({ query: q.get('query') || '', from, to }) });
  }

  if (p === '/api/admins') {
    if (req.method === 'GET') return sendJSON(res, 200, { admins: store.listAdmins().map((a) => ({ ...a, lastSeen: store.lastSeenOf(a.steamID) })) });
    if (req.method === 'POST') {
      if (!auth.can(sess.username, 'config')) return deny();
      const b = await readBody(req);
      try { if (b.remove) { store.removeAdmin(b.steamID); return sendJSON(res, 200, { ok: true }); }
        return sendJSON(res, 200, { admin: store.upsertAdmin(b) }); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
  }

  if (p === '/api/vip') {
    if (req.method === 'GET') return sendJSON(res, 200, { vip: store.listVip().map((v) => ({ ...v, lastSeen: store.lastSeenOf(v.steamID) })) });
    if (req.method === 'POST') {
      if (!auth.can(sess.username, 'reserve')) return deny();
      const b = await readBody(req);
      try { if (b.remove) { store.removeVip(b.steamID); return sendJSON(res, 200, { ok: true }); }
        return sendJSON(res, 200, { vip: store.upsertVip(b) }); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
  }

  if (p === '/api/banlist') {
    if (req.method === 'GET') return sendJSON(res, 200, { bans: store.listBans() });
    if (req.method === 'POST') {
      if (!auth.can(sess.username, 'ban')) return deny();
      const b = await readBody(req);
      if (b.remove) {
        const _rec = store.listBans().find((x) => x.steamID === b.steamID) || {};
        store.removeBan(b.steamID, b.createdAt);
        try { const server = (activeServer() || {}).name || 'Server'; discordSend(`**${server}** — ${sess.username} снял бан с **${_rec.name || b.name || b.steamID}** (${b.steamID})`); } catch (e) {}
        return sendJSON(res, 200, { ok: true });
      }
      const rec = store.addBan(b);
      // If online, also apply the ban over RCON by steamID.
      if (b.apply && b.steamID) { try { await rcon.execute(`AdminBan ${b.steamID} ${b.duration || 0} ${b.reason || 'Banned'}`); } catch (e) {} }
      try { const server = (activeServer() || {}).name || 'Server'; discordSend(`**${server}** — ${sess.username} ЗАБАНИЛ **${b.name || b.steamID}** (${b.steamID}) на ${banDurLabel(b.duration)} по причине: *${b.reason || 'Banned'}*`); } catch (e) {}
      return sendJSON(res, 200, { ban: rec });
    }
  }

  if (p === '/api/bannednames') {
    if (req.method === 'GET') return sendJSON(res, 200, { names: store.listBannedNames() });
    if (req.method === 'POST') {
      if (!auth.can(sess.username, 'ban')) return deny();
      const b = await readBody(req);
      if (b.remove) { store.removeBannedName(b.name, b.createdAt); try { discordSend(`${sess.username} снял бан ника **${b.name}**`); } catch (e) {} return sendJSON(res, 200, { ok: true }); }
      if (!b.name) return sendJSON(res, 400, { error: 'ник обязателен' });
      const _bn = store.addBannedName(b);
      try { discordSend(`${sess.username} забанил ник **${b.name}**`); } catch (e) {}
      return sendJSON(res, 200, { name: _bn });
    }
  }

  if (p === '/api/discord') {
    if (!auth.isOwner(sess.username)) return deny();
    if (req.method === 'GET') return sendJSON(res, 200, { enabled: !!discordCfg.enabled, hasWebhook: !!discordCfg.webhook });
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.webhook === 'string' && b.webhook.trim()) discordCfg.webhook = b.webhook.trim();
      if (b.clear === true) discordCfg.webhook = '';
      if (typeof b.enabled === 'boolean') discordCfg.enabled = b.enabled;
      saveDiscord();
      if (b.test) {
        const t = await discordPost(discordCfg.webhook, '✅ YAKO HUB — тест. Синхронизация с Discord работает.');
        return sendJSON(res, 200, { enabled: !!discordCfg.enabled, hasWebhook: !!discordCfg.webhook, test: t.ok, testError: t.error || null });
      }
      return sendJSON(res, 200, { enabled: !!discordCfg.enabled, hasWebhook: !!discordCfg.webhook });
    }
  }

  if (p === '/api/reasons') {
    if (req.method === 'GET') return sendJSON(res, 200, { reasons: punishReasons });
    if (req.method === 'POST') {
      if (!auth.isOwner(sess.username)) return deny();
      const b = await readBody(req);
      if (Array.isArray(b.reasons)) {
        const seen = new Set();
        punishReasons = b.reasons.map((x) => String(x).trim()).filter((x) => x && !seen.has(x) && seen.add(x)).slice(0, 100);
        saveReasons();
      }
      return sendJSON(res, 200, { reasons: punishReasons });
    }
  }

  if (p === '/api/servers') {
    if (req.method === 'GET') return sendJSON(res, 200, { servers: publicServers() });
    if (req.method === 'POST') {
      if (!auth.isOwner(sess.username)) return deny();
      const b = await readBody(req);
      if (b.op === 'add') {
        const id = (servers.reduce((m, s) => Math.max(m, s.id || 0), 0)) + 1;
        servers.push({ id, name: b.name || ('Server ' + id), host: b.host || '', port: b.port || '', password: b.password || '', active: servers.length === 0 });
        saveServers();
      } else if (b.op === 'update') {
        const sv = servers.find((x) => x.id === b.id);
        if (!sv) return sendJSON(res, 404, { error: 'нет сервера' });
        if (typeof b.name === 'string') sv.name = b.name;
        if (typeof b.host === 'string') sv.host = b.host;
        if (b.port != null && b.port !== '') sv.port = b.port;
        if (b.password) sv.password = b.password;
        saveServers();
        if (sv.active) applyActiveServer();
      } else if (b.op === 'remove') {
        const wasActive = !!(servers.find((x) => x.id === b.id) || {}).active;
        servers = servers.filter((x) => x.id !== b.id);
        if (wasActive && servers[0]) servers[0].active = true;
        saveServers(); applyActiveServer();
      } else if (b.op === 'activate') {
        servers.forEach((x) => { x.active = (x.id === b.id); });
        saveServers(); applyActiveServer();
        pushEvent({ type: 'system', message: 'Активный сервер: ' + ((activeServer() || {}).name || '') });
      }
      return sendJSON(res, 200, { servers: publicServers() });
    }
  }

  if (p === '/api/plugins' && req.method === 'GET') {
    return sendJSON(res, 200, { plugins: pluginEngine.list() });
  }

  if (p.startsWith('/api/plugins/') && req.method === 'POST') {
    if (!auth.can(sess.username, 'config')) return deny();
    const name = decodeURIComponent(p.slice('/api/plugins/'.length));
    const body = await readBody(req);
    try {
      const updated = pluginEngine.setPlugin(name, { enabled: body.enabled, options: body.options });
      pushEvent({ type: 'system', message: `Плагин ${name}: ${body.enabled ? 'включён' : 'выключен/обновлён'}` });
      return sendJSON(res, 200, { plugin: updated });
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
  }

  return sendJSON(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(__dirname, 'public', filePath);
  if (!full.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/auth/steam') {
    const realm = 'http://' + req.headers.host;
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': realm + '/auth/steam/return',
      'openid.realm': realm,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    res.writeHead(302, { Location: 'https://steamcommunity.com/openid/login?' + params.toString() });
    return res.end();
  }
  if (url.pathname === '/auth/steam/return') {
    const vp = new URLSearchParams();
    url.searchParams.forEach((v, k) => vp.set(k, v));
    vp.set('openid.mode', 'check_authentication');
    const ok = await steamVerify(vp.toString());
    const claimed = url.searchParams.get('openid.claimed_id') || '';
    const m = claimed.match(/\/id\/(\d{17})/);
    const steamID = m ? m[1] : null;
    const user = (ok && steamID) ? auth.findBySteam(steamID) : null;
    if (!user) {
      const reason = !ok ? 'fail' : (steamID ? ('nouser:' + steamID) : 'nosteam');
      res.writeHead(302, { Location: '/?steam=' + encodeURIComponent(reason) });
      return res.end();
    }
    const token = auth.loginAs(user.username);
    res.writeHead(302, { 'Set-Cookie': `yako_sess=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`, Location: '/' });
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, url);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }
  return serveStatic(req, res, url);
});

/* --------------------------- WebSocket (RFC 6455) --------------------------- */
/* Minimal server-push implementation so we avoid third-party deps. */

const wsClients = new Set();

function wsAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + text opcode
  return Buffer.concat([header, payload]);
}

function broadcast(obj) {
  const frame = encodeFrame(JSON.stringify(obj));
  for (const sock of wsClients) {
    try { sock.write(frame); } catch (e) { /* ignore */ }
  }
}

server.on('upgrade', (req, socket) => {
  if (!auth.session(getCookie(req, 'yako_sess'))) { socket.destroy(); return; }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );

  wsClients.add(socket);
  socket.write(encodeFrame(JSON.stringify({ type: 'system', message: 'stream connected', time: Date.now() })));

  // We mostly push. Read just enough to detect close frames.
  socket.on('data', (buf) => {
    const opcode = buf[0] & 0x0f;
    if (opcode === 0x8) { // close
      wsClients.delete(socket);
      socket.destroy();
    }
  });
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

server.listen(config.webPort, config.webHost, () => {
  console.log(`\nSquad Admin Panel running at http://${config.webHost}:${config.webPort}`);
  console.log(`RCON target: ${config.rconHost}:${config.rconPort}\n`);
});
