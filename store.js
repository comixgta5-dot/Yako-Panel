'use strict';

/**
 * Persistent data store for the panel (JSON files in ./data).
 *
 * RCON only exposes who is online right now, so to power "Все игроки",
 * "Администрация", "Привилегии" and "Забаненные" we keep our own store:
 *   - players.json : every steamID ever seen online, with name history,
 *                    first/last seen and accumulated online time.
 *   - admins.json  : managed admin/moderator list (can also import Admins.cfg).
 *   - vip.json     : VIP / privileged players.
 *   - banlist.json : bans (issued via panel + manual + optional Bans.cfg import).
 */

const fs = require('fs');
const path = require('path');

class Store {
  constructor({ dir, adminsFilePath, bansFilePath } = {}) {
    this.dir = dir || path.join(__dirname, 'data');
    this.adminsFilePath = adminsFilePath || null;
    this.bansFilePath = bansFilePath || null;
    if (!fs.existsSync(this.dir)) { try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) {} }

    this.players = this._load('players.json', {});   // steamID -> record
    this.admins = this._load('admins.json', []);
    this.vip = this._load('vip.json', []);
    this.banlist = this._load('banlist.json', []);
    this.bannedNames = this._load('bannednames.json', []);

    this._dirty = {};
    const _t = setInterval(() => this._flush(), 5000); if (_t.unref) _t.unref();
    // Try importing server config files once at startup.
    this.importAdminsCfg();
  }

  _path(f) { return path.join(this.dir, f); }
  _load(f, def) { try { if (fs.existsSync(this._path(f))) return JSON.parse(fs.readFileSync(this._path(f), 'utf8')); } catch (e) {} return def; }
  _save(f, data) { try { fs.writeFileSync(this._path(f), JSON.stringify(data, null, 2)); } catch (e) {} }
  _flush() { for (const f of Object.keys(this._dirty)) { this._save(f, this._dirty[f]()); } this._dirty = {}; }
  _mark(f, getter) { this._dirty[f] = getter; }

  /* ------------------------- Seen players ------------------------- */

  recordOnline(players, addSeconds = 30, seeding = false) {
    const now = Date.now();
    for (const p of players) {
      if (!p.steamID && !p.eosID) continue;
      const key = p.steamID || p.eosID;
      let r = this.players[key];
      if (!r) {
        r = { steamID: p.steamID || null, eosID: p.eosID || null, name: p.name || '', names: [], firstSeen: now, lastSeen: now, seconds: 0, seedSeconds: 0, discord: '' };
        this.players[key] = r;
      }
      if (p.name && !r.names.includes(p.name)) r.names.push(p.name);
      if (p.name) r.name = p.name;
      if (p.eosID) r.eosID = p.eosID;
      r.lastSeen = now;
      r.seconds += addSeconds;
      if (seeding) r.seedSeconds = (r.seedSeconds || 0) + addSeconds;
    }
    this._mark('players.json', () => this.players);
  }

  getAllPlayers({ query = '', from = null, to = null } = {}) {
    const q = query.trim().toLowerCase();
    let list = Object.values(this.players);
    if (q) list = list.filter((r) =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.steamID || '').includes(q) ||
      (r.eosID || '').toLowerCase().includes(q) ||
      r.names.some((n) => n.toLowerCase().includes(q)));
    if (from) list = list.filter((r) => r.lastSeen >= from);
    if (to) list = list.filter((r) => r.lastSeen <= to);
    list.sort((a, b) => b.lastSeen - a.lastSeen);
    return list;
  }

  lastSeenOf(steamID) { const r = this.players[steamID]; return r ? r.lastSeen : null; }
  getPlayer(key) {
    if (!key) return null;
    if (this.players[key]) return this.players[key];
    return Object.values(this.players).find((r) => r.steamID === key || r.eosID === key) || null;
  }

  /* ------------------------- Admins ------------------------- */

  listAdmins() { return this.admins.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '')); }
  upsertAdmin(a) {
    if (!a.steamID) throw new Error('steamID required');
    const i = this.admins.findIndex((x) => x.steamID === a.steamID);
    const rec = { steamID: a.steamID, name: a.name || '', group: a.group || 'Admin', discord: a.discord || '', note: a.note || '' };
    if (i >= 0) this.admins[i] = { ...this.admins[i], ...rec }; else this.admins.push(rec);
    this._mark('admins.json', () => this.admins);
    return rec;
  }
  removeAdmin(steamID) { this.admins = this.admins.filter((x) => x.steamID !== steamID); this._mark('admins.json', () => this.admins); }

  importAdminsCfg() {
    if (!this.adminsFilePath || !fs.existsSync(this.adminsFilePath)) return 0;
    let text = ''; try { text = fs.readFileSync(this.adminsFilePath, 'utf8'); } catch (e) { return 0; }
    let count = 0;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*Admin=(\d{17})\s*:\s*(\w+)/i);
      if (!m) continue;
      const comment = (line.split('//')[1] || '').trim();
      const existing = this.admins.find((x) => x.steamID === m[1]);
      if (!existing) { this.admins.push({ steamID: m[1], name: comment, group: m[2], discord: '', note: 'import' }); count++; }
    }
    if (count) this._mark('admins.json', () => this.admins);
    return count;
  }

  /* ------------------------- VIP ------------------------- */

  listVip() { return this.vip.slice().sort((a, b) => (b.until || 0) - (a.until || 0)); }
  upsertVip(v) {
    if (!v.steamID) throw new Error('steamID required');
    const i = this.vip.findIndex((x) => x.steamID === v.steamID);
    const rec = { steamID: v.steamID, name: v.name || '', note: v.note || '', until: v.until || null, addedAt: (i >= 0 ? this.vip[i].addedAt : Date.now()) };
    if (i >= 0) this.vip[i] = { ...this.vip[i], ...rec }; else this.vip.push(rec);
    this._mark('vip.json', () => this.vip);
    return rec;
  }
  removeVip(steamID) { this.vip = this.vip.filter((x) => x.steamID !== steamID); this._mark('vip.json', () => this.vip); }

  /* ------------------------- Bans ------------------------- */

  listBans() { return this.banlist.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
  addBan(b) {
    const rec = { steamID: b.steamID || '', name: b.name || '', reason: b.reason || '', duration: b.duration || '0', createdAt: Date.now(), source: b.source || 'panel' };
    this.banlist.push(rec);
    this._mark('banlist.json', () => this.banlist);
    return rec;
  }
  removeBan(steamID, createdAt) {
    this.banlist = this.banlist.filter((x) => !(x.steamID === steamID && (!createdAt || x.createdAt === createdAt)));
    this._mark('banlist.json', () => this.banlist);
  }
  importBansCfg() {
    if (!this.bansFilePath || !fs.existsSync(this.bansFilePath)) return 0;
    let text = ''; try { text = fs.readFileSync(this.bansFilePath, 'utf8'); } catch (e) { return 0; }
    let count = 0;
    for (const line of text.split('\n')) {
      const m = line.match(/(\d{17})/);
      if (!m) continue;
      if (!this.banlist.find((x) => x.steamID === m[1] && x.source === 'cfg')) {
        this.banlist.push({ steamID: m[1], name: (line.split('//')[1] || '').trim(), reason: 'Bans.cfg', duration: '', createdAt: Date.now(), source: 'cfg' });
        count++;
      }
    }
    if (count) this._mark('banlist.json', () => this.banlist);
    return count;
  }

  /* ------------------------- Banned nicknames ------------------------- */
  listBannedNames() { return this.bannedNames.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
  addBannedName(b) {
    const rec = { name: b.name || '', reason: b.reason || '', createdAt: Date.now() };
    this.bannedNames.push(rec);
    this._mark('bannednames.json', () => this.bannedNames);
    return rec;
  }
  removeBannedName(name, createdAt) {
    this.bannedNames = this.bannedNames.filter((x) => !(x.name === name && (!createdAt || x.createdAt === createdAt)));
    this._mark('bannednames.json', () => this.bannedNames);
  }
}

module.exports = { Store };
