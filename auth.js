'use strict';

/**
 * Authentication + roles for the panel.
 *
 * - Owner is the master account: has every permission, always; cannot be
 *   locked out (at least one owner is always kept).
 * - The Owner can create custom roles and toggle each role's permissions
 *   (what parts of the panel that role may use). Users are assigned a role.
 * - Passwords hashed with scrypt (Node built-in). Sessions are in-memory
 *   tokens delivered via an httpOnly cookie.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Grantable permission keys (Owner implicitly has all). users/roles/servers
// management stays Owner-only and is NOT in this list.
// Real Squad admin-group permissions (Admins.cfg). Order = screenshot column order
// (21 items -> 3 columns of 7 with CSS column layout).
const PERM_KEYS = [
  'startvote', 'changemap', 'pause', 'cheat', 'private', 'balance', 'chat',
  'kick', 'ban', 'config', 'cameraman', 'immune', 'manageserver', 'featuretest',
  'reserve', 'demos', 'clientdemos', 'debug', 'teamchange', 'forceteamchange', 'canseeadminchat',
];
const PERM_WARN = ['changemap', 'kick', 'ban', 'cheat', 'manageserver'];
const PERM_LABELS = {}; PERM_KEYS.forEach((k) => { PERM_LABELS[k] = k; });
const SESSION_TTL = 7 * 24 * 3600 * 1000;

class Auth {
  constructor({ dir, owner } = {}) {
    this.dir = dir || path.join(__dirname, 'data');
    if (!fs.existsSync(this.dir)) { try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) {} }
    this.users = this._load('users.json', []);
    this.roles = this._load('roles.json', null);
    this.sessions = new Map();

    if (!this.roles || (this.roles.length && !('kick' in (this.roles[0].permissions || {})))) {
      // fresh install, or migrate old (panel-perm) roles to Squad permissions
      this.roles = seedDefaultRoles();
      this._save('roles.json', this.roles);
    }
    if (!this.users.length) {
      const u = (owner && owner.username) || 'owner';
      const p = (owner && owner.password) || crypto.randomBytes(6).toString('hex');
      this._addUserRaw(u, p, 'owner');
      if (!(owner && owner.password)) {
        try { fs.writeFileSync(path.join(this.dir, 'owner-credentials.txt'), `username: ${u}\npassword: ${p}\n`); } catch (e) {}
        console.log(`\n[auth] Owner account created -> username: ${u}  password: ${p}\n(also saved to data/owner-credentials.txt — change it in the panel)\n`);
      }
    }
  }

  _path(f) { return path.join(this.dir, f); }
  _load(f, def) { try { if (fs.existsSync(this._path(f))) return JSON.parse(fs.readFileSync(this._path(f), 'utf8')); } catch (e) {} return def; }
  _save(f, d) { try { fs.writeFileSync(this._path(f), JSON.stringify(d, null, 2)); } catch (e) {} }

  _hash(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
  _addUserRaw(username, password, role, steamID) {
    const salt = crypto.randomBytes(16).toString('hex');
    this.users.push({ username, salt, hash: this._hash(password, salt), role, steamID: steamID || '', disabled: false, createdAt: Date.now() });
    this._save('users.json', this.users);
  }

  /* ------- users ------- */
  findUser(username) { return this.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase()); }
  ownersCount() { return this.users.filter((u) => u.role === 'owner' && !u.disabled).length; }

  verify(username, password) {
    const u = this.findUser(username);
    if (!u || u.disabled) return null;
    const h = this._hash(password, u.salt);
    if (h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return u;
    return null;
  }

  listUsers() { return this.users.map((u) => ({ username: u.username, role: u.role, steamID: u.steamID || '', disabled: !!u.disabled, createdAt: u.createdAt })); }

  createUser(a) {
    const { username, password, role } = a;
    if (!username || !password) throw new Error('username и пароль обязательны');
    if (this.findUser(username)) throw new Error('пользователь уже существует');
    if (role !== 'owner' && !this.roles.find((r) => r.name === role)) throw new Error('роль не найдена');
    this._addUserRaw(username, password, role || (this.roles[0] && this.roles[0].name) || 'owner', a.steamID);
    return { ok: true };
  }
  updateUser(username, { role, disabled, password, steamID }) {
    const u = this.findUser(username);
    if (!u) throw new Error('нет такого пользователя');
    if (u.role === 'owner' && (role && role !== 'owner' || disabled) && this.ownersCount() <= 1)
      throw new Error('нельзя убрать последнего Владельца');
    if (typeof role === 'string') { if (role !== 'owner' && !this.roles.find((r) => r.name === role)) throw new Error('роль не найдена'); u.role = role; }
    if (typeof disabled === 'boolean') u.disabled = disabled;
    if (password) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = this._hash(password, u.salt); }
    if (typeof steamID === 'string') u.steamID = steamID.trim();
    this._save('users.json', this.users);
    return { ok: true };
  }
  removeUser(username) {
    const u = this.findUser(username);
    if (!u) return;
    if (u.role === 'owner' && this.ownersCount() <= 1) throw new Error('нельзя удалить последнего Владельца');
    this.users = this.users.filter((x) => x !== u);
    this._save('users.json', this.users);
  }

  /* ------- roles ------- */
  listRoles() {
    return [{ name: 'owner', label: 'Владелец', color: '#86c440', permissions: allPerms(true), builtin: true }]
      .concat(this.roles.map((r) => ({ name: r.name, color: r.color || '#888888', permissions: { ...allPerms(false), ...r.permissions }, builtin: false })));
  }
  upsertRole({ name, color, permissions }) {
    if (!name) throw new Error('имя роли обязательно');
    if (name === 'owner') throw new Error('роль Владельца изменять нельзя');
    const perms = {}; for (const k of PERM_KEYS) perms[k] = !!(permissions && permissions[k]);
    const i = this.roles.findIndex((r) => r.name === name);
    if (i >= 0) { this.roles[i].permissions = perms; if (color) this.roles[i].color = color; }
    else this.roles.push({ name, color: color || '#888888', permissions: perms });
    this._save('roles.json', this.roles);
    return { ok: true };
  }
  removeRole(name) {
    if (name === 'owner') throw new Error('нельзя удалить Владельца');
    if (this.users.some((u) => u.role === name)) throw new Error('роль назначена пользователям — сначала смените им роль');
    this.roles = this.roles.filter((r) => r.name !== name);
    this._save('roles.json', this.roles);
  }

  /* ------- permissions ------- */
  permsFor(username) {
    const u = this.findUser(username);
    if (!u) return allPerms(false);
    if (u.role === 'owner') return allPerms(true);
    const r = this.roles.find((x) => x.name === u.role);
    return { ...allPerms(false), ...(r ? r.permissions : {}) };
  }
  can(username, perm) {
    const u = this.findUser(username);
    if (!u) return false;
    if (u.role === 'owner') return true;
    if (perm === 'owner') return false;
    return !!this.permsFor(username)[perm];
  }
  isOwner(username) { const u = this.findUser(username); return !!u && u.role === 'owner'; }

  /* ------- sessions ------- */
  login(username, password) {
    const u = this.verify(username, password);
    if (!u) return null;
    return this.loginAs(u.username);
  }
  loginAs(username) {
    const u = this.findUser(username);
    if (!u || u.disabled) return null;
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, { username: u.username, exp: Date.now() + SESSION_TTL });
    return token;
  }
  findBySteam(steamID) {
    if (!steamID) return null;
    return this.users.find((u) => u.steamID === steamID && !u.disabled) || null;
  }
  session(token) {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s || s.exp < Date.now()) { if (s) this.sessions.delete(token); return null; }
    const u = this.findUser(s.username);
    if (!u || u.disabled) return null;
    return { username: u.username, role: u.role };
  }
  logout(token) { if (token) this.sessions.delete(token); }
}

function allPerms(v) { const o = {}; for (const k of PERM_KEYS) o[k] = v; return o; }
function seedDefaultRoles() {
  const on = (...list) => { const o = allPerms(false); list.forEach((k) => (o[k] = true)); return o; };
  return [
    { name: 'Админ', color: '#CD5C5C', permissions: allPerms(true) },
    { name: 'Модератор', color: '#2E8B57', permissions: on('changemap', 'balance', 'chat', 'kick', 'ban', 'cameraman', 'teamchange', 'canseeadminchat') },
    { name: 'VIP', color: '#DAA520', permissions: on('balance', 'reserve') },
    { name: 'Камера', color: '#8B008B', permissions: on('balance', 'cameraman', 'reserve', 'teamchange') },
  ];
}

module.exports = { Auth, PERM_KEYS, PERM_LABELS, PERM_WARN };
