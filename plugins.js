'use strict';

/**
 * Plugin engine for the Squad Admin Panel.
 *
 * Порт идей плагинов из RNSquadJS (github.com/lACTEPUKCl/RNSquadJS) и событий
 * из squad-rcon (github.com/iamalone98/squad-rcon), адаптированный под работу
 * ТОЛЬКО через RCON (без доступа к лог-файлу сервера). Поэтому реализованы те
 * плагины, которым достаточно RCON-событий (чат, создание отряда, админ-камера)
 * и периодического опроса ListPlayers:
 *   - broadcast          — периодические сообщения в чат
 *   - chatCommands       — реакции на !команды (!report, !discord, !help, ...)
 *   - skipmapVote        — голосование за пропуск карты
 *   - autoKickUnassigned — кик игроков вне отряда после предупреждений
 *   - warnOnSquadCreate  — напоминание создателю отряда про роль SL
 *   - adminCamAlert      — оповещение админов о входе в админ-камеру
 *
 * Каждый плагин включается/настраивается через панель и хранится в plugins.json.
 */

const fs = require('fs');
const path = require('path');
const { parsePlayers } = require('./rcon');

/* ------------------------------ Plugin defs ------------------------------ */

const PLUGINS = {
  broadcast: {
    title: 'Broadcast',
    description: 'Периодически отправляет сообщения всем игрокам (по кругу).',
    schema: [
      { key: 'intervalSeconds', label: 'Интервал (сек)', type: 'number' },
      { key: 'onlyWhenPlayers', label: 'Только когда есть игроки', type: 'boolean' },
      { key: 'messages', label: 'Сообщения (по одному в строке)', type: 'lines' },
    ],
    defaults: {
      intervalSeconds: 300,
      onlyWhenPlayers: true,
      messages: ['Добро пожаловать на сервер!', 'Соблюдайте правила и уважайте других игроков.'],
    },
    start(ctx) {
      let i = 0;
      ctx.every(Math.max(3, ctx.options.intervalSeconds) * 1000, async () => {
        const msgs = ctx.options.messages || [];
        if (!msgs.length) return;
        if (ctx.options.onlyWhenPlayers) {
          const players = await ctx.listPlayers();
          if (!players.length) return;
        }
        const msg = msgs[i % msgs.length];
        i++;
        await ctx.broadcast(msg);
        ctx.log({ type: 'plugin', plugin: 'broadcast', message: `Broadcast: ${msg}` });
      });
    },
  },

  chatCommands: {
    title: 'Chat Commands',
    description: 'Отвечает на команды в чате. !report уведомляет админов; остальные — авто-ответ игроку.',
    schema: [
      { key: 'reportEnabled', label: 'Включить !report', type: 'boolean' },
      { key: 'commands', label: 'Команды (формат: !cmd = ответ, по строке)', type: 'map' },
    ],
    defaults: {
      reportEnabled: true,
      commands: {
        '!discord': 'Наш Discord: discord.gg/yourserver',
        '!rules': 'Правила: не тимкилль, слушай командира, уважай игроков.',
      },
    },
    start(ctx) {
      ctx.on('CHAT_MESSAGE', async (m) => {
        const text = (m.message || '').trim();
        const low = text.toLowerCase();

        if (ctx.options.reportEnabled && low.startsWith('!report')) {
          const reason = text.slice(7).trim() || '(без описания)';
          await ctx.admin(`[REPORT] ${m.name}: ${reason}`);
          await ctx.warnSteam(m.steamID, 'Ваша жалоба отправлена администраторам.');
          ctx.log({ type: 'report', name: m.name, steamID: m.steamID, message: reason });
          return;
        }
        if (low === '!admins') {
          await ctx.admin(`Игрок ${m.name} зовёт админов (!admins).`);
          await ctx.warnSteam(m.steamID, 'Администраторы уведомлены.');
          ctx.log({ type: 'report', name: m.name, steamID: m.steamID, message: '!admins' });
          return;
        }
        const cmds = ctx.options.commands || {};
        if (low === '!help') {
          const list = ['!report', '!admins', '!help', ...Object.keys(cmds)].join(', ');
          await ctx.warnSteam(m.steamID, `Доступные команды: ${list}`);
          return;
        }
        for (const key of Object.keys(cmds)) {
          if (low === key.toLowerCase()) {
            await ctx.warnSteam(m.steamID, cmds[key]);
            return;
          }
        }
      });
    },
  },

  skipmapVote: {
    title: 'Skip Map Vote',
    description: 'Игроки командой запускают голосование за пропуск текущей карты.',
    schema: [
      { key: 'command', label: 'Команда запуска', type: 'text' },
      { key: 'yesToken', label: 'Символ голоса «за»', type: 'text' },
      { key: 'voteSeconds', label: 'Длительность голосования (сек)', type: 'number' },
      { key: 'requiredVotes', label: 'Нужно голосов', type: 'number' },
      { key: 'cooldownSeconds', label: 'Кулдаун между голосованиями (сек)', type: 'number' },
    ],
    defaults: { command: '!skipmap', yesToken: '+', voteSeconds: 60, requiredVotes: 15, cooldownSeconds: 600 },
    start(ctx) {
      let active = false;
      let votes = new Set();
      let cooldownUntil = 0;

      ctx.on('CHAT_MESSAGE', async (m) => {
        const text = (m.message || '').trim();
        if (text.toLowerCase() === String(ctx.options.command).toLowerCase()) {
          if (active) return;
          const now = Date.now();
          if (now < cooldownUntil) {
            await ctx.warnSteam(m.steamID, `Голосование недавно проходило. Подождите.`);
            return;
          }
          active = true;
          votes = new Set();
          const need = ctx.options.requiredVotes;
          const dur = ctx.options.voteSeconds;
          await ctx.broadcast(`Голосование за ПРОПУСК карты! Пишите "${ctx.options.yesToken}" в чат. Нужно ${need} голосов за ${dur} сек.`);
          ctx.log({ type: 'plugin', plugin: 'skipmapVote', message: 'Запущено голосование за пропуск карты' });
          ctx.timeout(dur * 1000, async () => {
            active = false;
            cooldownUntil = Date.now() + ctx.options.cooldownSeconds * 1000;
            if (votes.size >= need) {
              await ctx.broadcast(`Карта пропущена голосованием (${votes.size}/${need}).`);
              await ctx.rcon.execute('AdminEndMatch');
              ctx.log({ type: 'plugin', plugin: 'skipmapVote', message: `Карта пропущена (${votes.size}/${need})` });
            } else {
              await ctx.broadcast(`Голосование не прошло (${votes.size}/${need}).`);
              ctx.log({ type: 'plugin', plugin: 'skipmapVote', message: `Не хватило голосов (${votes.size}/${need})` });
            }
          });
          return;
        }
        if (active && text === String(ctx.options.yesToken)) {
          votes.add(m.steamID);
        }
      });
    },
  },

  autoKickUnassigned: {
    title: 'Auto-Kick Unassigned',
    description: 'Предупреждает и кикает игроков, не вступивших в отряд, после льготного периода.',
    schema: [
      { key: 'minPlayers', label: 'Мин. игроков для работы', type: 'number' },
      { key: 'graceSeconds', label: 'Льготный период (сек)', type: 'number' },
      { key: 'checkEverySeconds', label: 'Проверять каждые (сек)', type: 'number' },
      { key: 'warnMessage', label: 'Текст предупреждения', type: 'text' },
      { key: 'kickMessage', label: 'Причина кика', type: 'text' },
    ],
    defaults: {
      minPlayers: 40, graceSeconds: 300, checkEverySeconds: 60,
      warnMessage: 'Вступите в отряд, иначе будете кикнуты!',
      kickMessage: 'Кик: не в отряде',
    },
    start(ctx) {
      const seen = new Map(); // steamID -> firstUnassignedTs
      ctx.every(Math.max(3, ctx.options.checkEverySeconds) * 1000, async () => {
        const players = await ctx.listPlayers();
        if (players.length < ctx.options.minPlayers) { seen.clear(); return; }
        const now = Date.now();
        const online = new Set(players.map((p) => p.steamID));
        for (const key of [...seen.keys()]) if (!online.has(key)) seen.delete(key);

        for (const p of players) {
          if (p.squadID) { seen.delete(p.steamID); continue; }
          const first = seen.get(p.steamID) || now;
          if (!seen.has(p.steamID)) seen.set(p.steamID, now);
          if (now - first >= ctx.options.graceSeconds * 1000) {
            await ctx.kickId(p.id, ctx.options.kickMessage);
            seen.delete(p.steamID);
            ctx.log({ type: 'plugin', plugin: 'autoKickUnassigned', message: `Кикнут ${p.name} (не в отряде)` });
          } else {
            await ctx.warnId(p.id, ctx.options.warnMessage);
          }
        }
      });
    },
  },

  warnOnSquadCreate: {
    title: 'Squad Leader Reminder',
    description: 'При создании отряда напоминает создателю про роль командира отряда.',
    schema: [{ key: 'message', label: 'Сообщение', type: 'text' }],
    defaults: { message: 'Вы создали отряд и теперь Командир отряда (SL). Возьмите кит SL и ставьте точки!' },
    start(ctx) {
      ctx.on('SQUAD_CREATED', async (d) => {
        await ctx.warnSteam(d.steamID, ctx.options.message);
        ctx.log({ type: 'plugin', plugin: 'warnOnSquadCreate', message: `Напоминание SL: ${d.name} (${d.squadName})` });
      });
    },
  },

  adminCamAlert: {
    title: 'Admin Camera Alert',
    description: 'Оповещает админ-чат, когда кто-то входит в админ-камеру.',
    schema: [{ key: 'notify', label: 'Оповещать админ-чат', type: 'boolean' }],
    defaults: { notify: true },
    start(ctx) {
      ctx.on('POSSESSED_ADMIN_CAMERA', async (d) => {
        if (ctx.options.notify) await ctx.admin(`${d.name} вошёл в админ-камеру.`);
        ctx.log({ type: 'plugin', plugin: 'adminCamAlert', message: `${d.name} вошёл в админ-камеру` });
      });
    },
  },

  voteMap: {
    title: 'Vote Map',
    description: 'Голосование за следующую карту: команда предлагает случайные варианты, игроки голосуют цифрой.',
    schema: [
      { key: 'command', label: 'Команда запуска', type: 'text' },
      { key: 'choices', label: 'Сколько вариантов', type: 'number' },
      { key: 'voteSeconds', label: 'Длительность (сек)', type: 'number' },
      { key: 'cooldownSeconds', label: 'Кулдаун (сек)', type: 'number' },
      { key: 'layers', label: 'Пул карт (по одной в строке)', type: 'lines' },
    ],
    defaults: {
      command: '!votemap', choices: 4, voteSeconds: 60, cooldownSeconds: 600,
      layers: ['AlBasrah_RAAS_v1', 'Yehorivka_RAAS_v1', 'Narva_RAAS_v1', 'GooseBay_RAAS_v1', 'Mutaha_RAAS_v1', 'Fallujah_RAAS_v1', 'Gorodok_RAAS_v1', 'Sumari_AAS_v1'],
    },
    start(ctx) {
      let active = false, votes = {}, options = [], cooldownUntil = 0;
      ctx.on('CHAT_MESSAGE', async (m) => {
        const text = (m.message || '').trim();
        if (text.toLowerCase() === String(ctx.options.command).toLowerCase()) {
          if (active) return;
          if (Date.now() < cooldownUntil) { await ctx.warnSteam(m.steamID, 'Голосование за карту недавно проходило.'); return; }
          const pool = (ctx.options.layers || []).slice();
          if (pool.length < 2) return;
          options = [];
          const n = Math.min(Math.max(2, ctx.options.choices || 4), pool.length, 6);
          for (let i = 0; i < n; i++) { const idx = Math.floor(Math.random() * pool.length); options.push(pool.splice(idx, 1)[0]); }
          votes = {}; active = true;
          await ctx.broadcast('Голосование за карту! Пишите цифру:');
          for (let i = 0; i < options.length; i++) await ctx.broadcast(`${i + 1}) ${options[i]}`);
          ctx.log({ type: 'plugin', plugin: 'voteMap', message: 'Запущено голосование за карту: ' + options.join(', ') });
          ctx.timeout((ctx.options.voteSeconds || 60) * 1000, async () => {
            active = false; cooldownUntil = Date.now() + (ctx.options.cooldownSeconds || 600) * 1000;
            const tally = options.map((_, i) => Object.values(votes).filter((v) => v === i).length);
            let best = 0; for (let i = 1; i < tally.length; i++) if (tally[i] > tally[best]) best = i;
            if (tally[best] > 0) {
              await ctx.setNextLayer(options[best]);
              await ctx.broadcast(`Следующая карта: ${options[best]} (${tally[best]} голосов)`);
              ctx.log({ type: 'plugin', plugin: 'voteMap', message: `Выбрана карта ${options[best]} (${tally[best]})` });
            } else { await ctx.broadcast('Никто не проголосовал — карта не изменена.'); }
          });
          return;
        }
        if (active) {
          const num = parseInt(text, 10);
          if (num >= 1 && num <= options.length) votes[m.steamID] = num - 1;
        }
      });
    },
  },

  seed: {
    title: 'Seeding Messages',
    description: 'Пока сервер сидится (мало игроков), периодически шлёт сообщения-напоминания.',
    schema: [
      { key: 'maxPlayers', label: 'Считать сидингом до N игроков', type: 'number' },
      { key: 'intervalSeconds', label: 'Интервал (сек)', type: 'number' },
      { key: 'messages', label: 'Сообщения (по одному в строке)', type: 'lines' },
    ],
    defaults: {
      maxPlayers: 50, intervalSeconds: 300,
      messages: ['Идёт сидинг! Занимайте точки, стройте FOB, зовите друзей.', 'Спасибо, что сидите сервер! Скоро полный матч.'],
    },
    start(ctx) {
      let i = 0;
      ctx.every(Math.max(30, ctx.options.intervalSeconds) * 1000, async () => {
        const players = await ctx.listPlayers();
        if (!players.length || players.length > (ctx.options.maxPlayers || 50)) return;
        const msgs = ctx.options.messages || []; if (!msgs.length) return;
        await ctx.broadcast(msgs[i % msgs.length]); i++;
        ctx.log({ type: 'plugin', plugin: 'seed', message: 'Seeding broadcast (' + players.length + ' игроков)' });
      });
    },
  },

  squadLeaderRole: {
    title: 'Squad Leader Kit',
    description: 'Предупреждает командиров отрядов, у которых не взят кит SL (по данным ListPlayers).',
    schema: [
      { key: 'checkEverySeconds', label: 'Проверять каждые (сек)', type: 'number' },
      { key: 'message', label: 'Текст предупреждения', type: 'text' },
    ],
    defaults: { checkEverySeconds: 120, message: 'Вы командир отряда — возьмите кит SL (Squad Leader)!' },
    start(ctx) {
      ctx.every(Math.max(30, ctx.options.checkEverySeconds) * 1000, async () => {
        const players = await ctx.listPlayers();
        for (const p of players) {
          if (p.isLeader && p.squadID && p.role && !/(_SL_|SquadLead|_Leader)/i.test(p.role)) {
            await ctx.warnId(p.id, ctx.options.message);
            ctx.log({ type: 'plugin', plugin: 'squadLeaderRole', message: `SL без кита: ${p.name}` });
          }
        }
      });
    },
  },

  adminCamBlocker: {
    title: 'Admin Cam Blocker',
    description: 'Если в админ-камеру заходит НЕ админ (нет в списке Администрация) — предупреждает или кикает.',
    schema: [
      { key: 'action', label: 'Действие: warn или kick', type: 'text' },
      { key: 'message', label: 'Сообщение / причина', type: 'text' },
    ],
    defaults: { action: 'warn', message: 'Админ-камера доступна только администраторам.' },
    start(ctx) {
      ctx.on('POSSESSED_ADMIN_CAMERA', async (d) => {
        if (ctx.isAdmin(d.steamID)) return;
        if (String(ctx.options.action).toLowerCase() === 'kick') await ctx.kickSteam(d.steamID, ctx.options.message);
        else await ctx.warnSteam(d.steamID, ctx.options.message);
        ctx.log({ type: 'plugin', plugin: 'adminCamBlocker', message: `Не-админ в админ-камере: ${d.name} (${String(ctx.options.action)})` });
      });
    },
  },
};

/* ------------------------------ Engine ------------------------------ */

class PluginEngine {
  constructor({ rcon, onLog, configPath, store }) {
    this.rcon = rcon;
    this.onLog = onLog || (() => {});
    this.store = store || null;
    this.configPath = configPath || path.join(__dirname, 'plugins.json');
    this.config = this._loadConfig();
    this.active = new Map(); // name -> { cleanup: [] }
    this._playersCache = { at: 0, players: [] };
  }

  _loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (e) { /* ignore */ }
    return {};
  }

  _saveConfig() {
    try { fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2)); } catch (e) { /* ignore */ }
  }

  optionsFor(name) {
    const def = PLUGINS[name].defaults;
    const saved = (this.config[name] && this.config[name].options) || {};
    return { ...def, ...saved };
  }

  list() {
    return Object.keys(PLUGINS).map((name) => ({
      name,
      title: PLUGINS[name].title,
      description: PLUGINS[name].description,
      schema: PLUGINS[name].schema,
      enabled: !!(this.config[name] && this.config[name].enabled),
      running: this.active.has(name),
      options: this.optionsFor(name),
    }));
  }

  startAll() {
    for (const name of Object.keys(PLUGINS)) {
      if (this.config[name] && this.config[name].enabled) this._start(name);
    }
  }

  stopAll() {
    for (const name of [...this.active.keys()]) this._stop(name);
  }

  setPlugin(name, { enabled, options }) {
    if (!PLUGINS[name]) throw new Error('unknown plugin: ' + name);
    const cur = this.config[name] || { enabled: false, options: {} };
    if (typeof enabled === 'boolean') cur.enabled = enabled;
    if (options && typeof options === 'object') cur.options = { ...cur.options, ...options };
    this.config[name] = cur;
    this._saveConfig();
    // restart
    this._stop(name);
    if (cur.enabled && this.rcon.authed) this._start(name);
    return this.list().find((p) => p.name === name);
  }

  // Called when RCON (re)connects so timer/event plugins attach to a live socket.
  onRconReady() {
    this.stopAll();
    this.startAll();
  }

  async _listPlayers() {
    const now = Date.now();
    if (now - this._playersCache.at < 3000) return this._playersCache.players;
    try {
      const text = await this.rcon.execute('ListPlayers');
      const players = parsePlayers(text);
      this._playersCache = { at: now, players };
      return players;
    } catch (e) {
      return this._playersCache.players;
    }
  }

  _ctx(name) {
    const cleanup = [];
    const options = this.optionsFor(name);
    const self = this;
    const ctx = {
      rcon: this.rcon,
      options,
      log: (evt) => self.onLog({ ...evt }),
      broadcast: (msg) => self.rcon.execute(`AdminBroadcast ${msg}`).catch(() => {}),
      admin: (msg) => self.rcon.execute(`ChatToAdmin ${msg}`).catch(() => {}),
      warnSteam: (steam, msg) => (steam ? self.rcon.execute(`AdminWarn ${steam} ${msg}`).catch(() => {}) : Promise.resolve()),
      warnId: (id, msg) => self.rcon.execute(`AdminWarnById ${id} ${msg}`).catch(() => {}),
      kickId: (id, msg) => self.rcon.execute(`AdminKickById ${id} ${msg}`).catch(() => {}),
      kickSteam: (steam, msg) => (steam ? self.rcon.execute(`AdminKick ${steam} ${msg}`).catch(() => {}) : Promise.resolve()),
      setNextLayer: (layer) => self.rcon.execute(`AdminSetNextLayer ${layer}`).catch(() => {}),
      isAdmin: (steam) => !!(self.store && self.store.listAdmins && self.store.listAdmins().some((a) => a.steamID === steam)),
      listPlayers: () => self._listPlayers(),
      on: (event, handler) => {
        self.rcon.on(event, handler);
        cleanup.push(() => self.rcon.removeListener(event, handler));
      },
      every: (ms, fn) => {
        const t = setInterval(() => { Promise.resolve(fn()).catch(() => {}); }, ms);
        cleanup.push(() => clearInterval(t));
      },
      timeout: (ms, fn) => {
        const t = setTimeout(() => { Promise.resolve(fn()).catch(() => {}); }, ms);
        cleanup.push(() => clearTimeout(t));
      },
    };
    return { ctx, cleanup };
  }

  _start(name) {
    if (this.active.has(name)) return;
    const { ctx, cleanup } = this._ctx(name);
    try {
      PLUGINS[name].start(ctx);
      this.active.set(name, { cleanup });
      this.onLog({ type: 'plugin', plugin: name, message: `Плагин "${PLUGINS[name].title}" запущен` });
    } catch (e) {
      cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
    }
  }

  _stop(name) {
    const a = this.active.get(name);
    if (!a) return;
    a.cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
    this.active.delete(name);
  }
}

module.exports = { PluginEngine, PLUGINS };
