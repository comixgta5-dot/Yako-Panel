'use strict';

/**
 * Squad RCON client.
 *
 * Реализация выверена по эталонной библиотеке iamalone98/squad-rcon
 * (https://github.com/iamalone98/squad-rcon) и протоколу Valve Source RCON
 * (https://developer.valvesoftware.com/wiki/Source_RCON_Protocol).
 *
 * Ключевые особенности Squad:
 *   - Пакет: int32 size | int32 id | int32 type | body(UTF-8) | 0x00 0x00
 *   - Типы: 0 = RESPONSE, 1 = SERVER(chat/события), 2 = COMMAND/AUTH_RESP, 3 = AUTH
 *   - Определение конца (в т.ч. многопакетного) ответа: после команды шлём
 *     ПУСТОЙ command-пакет с фиксированным id (100). Сервер отвечает телом
 *     команды, а затем пустым RESPONSE-пакетом — это и есть терминатор.
 *     Дополнительно Squad присылает 7-байтовый SOH-маркер (00 01 00 00 00 00 00),
 *     который тоже трактуется как пустой ответ.
 *   - Авторизация: AUTH-пакет с id 101; успех — приходит COMMAND-пакет с id 101,
 *     ошибка — id === -1.
 *   - Чат и события (варны, кики, баны, создание отряда, админ-камера) приходят
 *     асинхронно как SERVER-пакеты (type 1).
 */

const net = require('net');
const EventEmitter = require('events');

const SERVERDATA_RESPONSE = 0;
const SERVERDATA_SERVER = 1; // async chat/events
const SERVERDATA_COMMAND = 2; // exec + auth-response
const SERVERDATA_AUTH = 3;

const EMPTY_PACKET_ID = 100;
const AUTH_PACKET_ID = 101;

class SquadRcon extends EventEmitter {
  constructor({ host, port, password, autoReconnect = true, autoReconnectDelay = 5000 }) {
    super();
    this.host = host;
    this.port = Number(port);
    this.password = String(password);
    this.autoReconnect = autoReconnect;
    this.autoReconnectDelay = autoReconnectDelay;

    this.client = null;
    this.connected = false;
    this.authed = false;

    this.commandId = 0;
    this.responseBody = '';
    this.lastBuffer = Buffer.alloc(0);
    this._cmdQueue = [];  // pending commands (FIFO)
    this._current = null; // command awaiting its response
    this._closing = false;
    this._reconnectTimer = null;

    // 7-byte SOH terminator, decoded as an empty RESPONSE packet.
    this._soh = { size: 7, id: 0, type: SERVERDATA_RESPONSE, body: '' };
  }

  get status() {
    return { connected: this.connected, authed: this.authed, host: this.host, port: this.port };
  }

  connect() {
    this._closing = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      this.once('ready', () => { if (!settled) { settled = true; resolve(); } });
      this.once('authfail', () => { if (!settled) { settled = true; reject(new Error('RCON authentication failed (wrong password?)')); } });
      this.once('connecterror', (e) => { if (!settled) { settled = true; reject(e); } });
      this._open();
    });
  }

  _open() {
    this._cmdQueue = [];
    this._current = null;
    this.responseBody = '';
    this.lastBuffer = Buffer.alloc(0);

    const client = net.createConnection({ host: this.host, port: this.port, noDelay: true });
    this.client = client;

    client.on('data', (d) => this._onData(d));
    client.on('close', () => this._onClose());
    client.on('error', (e) => this._onError(e));
    client.once('ready', () => this._auth());
  }

  close() {
    this._closing = true;
    clearTimeout(this._reconnectTimer);
    if (this.client) this.client.end();
    this.connected = false;
    this.authed = false;
  }

  // Switch to a different server's RCON on the fly.
  reconfigure({ host, port, password }) {
    this.close();
    if (this.client) { try { this.client.destroy(); } catch (e) {} }
    this.host = host;
    this.port = Number(port);
    this.password = String(password);
    this._closing = false;
    return this.connect().catch(() => {});
  }

  _auth() {
    this.client.write(this._encode(SERVERDATA_AUTH, AUTH_PACKET_ID, this.password));
  }

  _reconnect() {
    this.connected = false;
    this.authed = false;
    if (this.autoReconnect && !this._closing) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => { this._open(); }, this.autoReconnectDelay);
    }
  }

  execute(command) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) return reject(new Error('RCON is not connected'));
      this._cmdQueue.push({ command, resolve, reject });
      this._drainQueue();
    });
  }

  // Send only ONE command at a time; the next is sent after the current
  // command's response terminator arrives. Prevents pipelined responses from
  // being mixed up (e.g. ListSquads bleeding into ListPlayers).
  _drainQueue() {
    if (this._current || !this._cmdQueue.length || !this.connected) return;
    const item = this._cmdQueue.shift();
    this._current = item;
    this.responseBody = '';
    this.commandId = this.commandId >= 80 ? 1 : this.commandId + 1;
    item.timer = setTimeout(() => this._finishCurrent(), 5000); // safety for commands with no body
    try {
      this.client.write(this._encode(SERVERDATA_COMMAND, this.commandId, item.command));
      this.client.write(this._encode(SERVERDATA_COMMAND, EMPTY_PACKET_ID, ''));
    } catch (e) {
      clearTimeout(item.timer);
      this._current = null;
      item.reject(e);
      this._drainQueue();
    }
  }

  _finishCurrent() {
    const item = this._current;
    if (!item) return;
    clearTimeout(item.timer);
    this._current = null;
    const body = this.responseBody;
    this.responseBody = '';
    try { item.resolve(body); } catch (e) {}
    this._drainQueue();
  }

  _onData(data) {
    this.lastBuffer = Buffer.concat([this.lastBuffer, data]);
    while (this.lastBuffer.byteLength >= 7) {
      const packet = this._decode();
      if (!packet) break;

      if (packet.type === SERVERDATA_RESPONSE) {
        this._onResponse(packet);
      } else if (packet.type === SERVERDATA_SERVER) {
        this._onServer(packet.body);
      } else if (packet.type === SERVERDATA_COMMAND) {
        if (packet.id === AUTH_PACKET_ID) {
          this._onConnected();
        } else if (packet.id === -1) {
          this.emit('authfail');
          this._reconnect();
        }
      }
    }
  }

  _onResponse(packet) {
    if (!this._current) return; // stray/unsolicited response
    if (packet.body === '') {
      this._finishCurrent(); // terminator -> resolve current command
    } else if (!packet.body.includes('\x00\x00\x00\x01\x00\x00\x00')) {
      this.responseBody += packet.body;
    } else {
      this._badPacket();
    }
  }

  _onConnected() {
    if (!this.connected) {
      this.connected = true;
      this.authed = true;
      this.emit('ready');
      this._drainQueue();
    }
  }

  _onClose() {
    const wasUp = this.connected;
    this.connected = false;
    this.authed = false;
    if (this._current) { clearTimeout(this._current.timer); try { this._current.reject(new Error('RCON disconnected')); } catch (e) {} this._current = null; }
    while (this._cmdQueue.length) { const it = this._cmdQueue.shift(); try { it.reject(new Error('RCON disconnected')); } catch (e) {} }
    this.emit('close');
    if (!wasUp && !this._closing) this.emit('connecterror', new Error('Connection closed before auth'));
    this._reconnect();
  }

  _onError(err) {
    this.emit('error', err);
    if (!this.connected) this.emit('connecterror', err);
  }

  _encode(type, id, body) {
    const size = Buffer.byteLength(body) + 14;
    const buf = Buffer.alloc(size);
    buf.writeInt32LE(size - 4, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    buf.write(body, 12, size - 2, 'utf-8');
    buf.writeInt16LE(0, size - 2);
    return buf;
  }

  _decode() {
    const b = this.lastBuffer;
    // 7-byte SOH terminator: 00 01 00 00 00 00 00
    if (b.byteLength >= 7 && b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0 && b[4] === 0 && b[5] === 0 && b[6] === 0) {
      this.lastBuffer = b.subarray(7);
      return this._soh;
    }
    if (b.byteLength < 4) return null;
    const size = b.readInt32LE(0);
    if (size > 8192 || size < 10) { this._badPacket(); return null; }
    if (size > b.byteLength - 4) return null; // wait for more

    const id = b.readInt32LE(4);
    const type = b.readInt32LE(8);
    if (b[size + 2] !== 0 || b[size + 3] !== 0 || id < 0 || type < 0 || type > 5) {
      this._badPacket();
      return null;
    }
    const body = b.toString('utf8', 12, size + 2);
    this.lastBuffer = b.subarray(size + 4);
    return { size, id, type, body };
  }

  _badPacket() {
    this.lastBuffer = Buffer.alloc(0);
    return null;
  }

  // Parse an async SERVER packet into a typed event (mirrors squad-rcon chatParser).
  _onServer(body) {
    const now = new Date();

    let m = body.match(/\[(ChatAll|ChatTeam|ChatSquad|ChatAdmin)\] \[Online IDs:EOS: ([0-9a-f]{32}) steam: (\d{17})\] (.+?) : (.*)/);
    if (m) {
      const data = { raw: body, chat: m[1], eosID: m[2], steamID: m[3], name: m[4], message: m[5], time: now };
      this.emit('CHAT_MESSAGE', data);
      this.emit('chat', { channel: m[1], eosID: m[2], steamID: m[3], name: m[4], message: m[5], raw: body }, body);
      return;
    }

    m = body.match(/\[Online Ids:EOS: ([0-9a-f]{32}) steam: (\d{17})\] (.+) has possessed admin camera\./);
    if (m) {
      const data = { raw: body, eosID: m[1], steamID: m[2], name: m[3], time: now };
      this.emit('POSSESSED_ADMIN_CAMERA', data);
      this.emit('event', { event: 'POSSESSED_ADMIN_CAMERA', name: m[3], steamID: m[2], raw: body });
      return;
    }

    m = body.match(/\[Online IDs:EOS: ([0-9a-f]{32}) steam: (\d{17})\] (.+) has unpossessed admin camera\./);
    if (m) {
      const data = { raw: body, eosID: m[1], steamID: m[2], name: m[3], time: now };
      this.emit('UNPOSSESSED_ADMIN_CAMERA', data);
      this.emit('event', { event: 'UNPOSSESSED_ADMIN_CAMERA', name: m[3], steamID: m[2], raw: body });
      return;
    }

    m = body.match(/Remote admin has warned player (.*)\. Message was "(.*)"/);
    if (m) {
      const data = { raw: body, name: m[1], reason: m[2], time: now };
      this.emit('PLAYER_WARNED', data);
      this.emit('event', { event: 'PLAYER_WARNED', name: m[1], reason: m[2], raw: body });
      return;
    }

    m = body.match(/Kicked player ([0-9]+)\. \[Online IDs= EOS: ([0-9a-f]{32}) steam: (\d{17})\] (.*)/);
    if (m) {
      const data = { raw: body, playerID: m[1], eosID: m[2], steamID: m[3], name: m[4], time: now };
      this.emit('PLAYER_KICKED', data);
      this.emit('event', { event: 'PLAYER_KICKED', name: m[4], steamID: m[3], raw: body });
      return;
    }

    m = body.match(/Banned player ([0-9]+)\. \[steamid=(.*?)\] (.*) for interval (.*)/);
    if (m) {
      const data = { raw: body, playerID: m[1], steamID: m[2], name: m[3], interval: m[4], time: now };
      this.emit('PLAYER_BANNED', data);
      this.emit('event', { event: 'PLAYER_BANNED', name: m[3], steamID: m[2], interval: m[4], raw: body });
      return;
    }

    m = body.match(/(.+) \(Online IDs: EOS: ([0-9a-f]{32}) steam: (\d{17})\) has created Squad (\d+) \(Squad Name: (.+)\) on (.+)/);
    if (m) {
      const data = { raw: body, name: m[1], eosID: m[2], steamID: m[3], squadID: m[4], squadName: m[5], teamName: m[6], time: now };
      this.emit('SQUAD_CREATED', data);
      this.emit('event', { event: 'SQUAD_CREATED', name: m[1], steamID: m[3], squadID: m[4], squadName: m[5], teamName: m[6], raw: body });
      return;
    }

    // Unrecognized server message -> still surface it for the log feed.
    this.emit('event', { event: 'SERVER', raw: body });
  }
}

/* ----------------------------- Parsers ----------------------------- */

function parsePlayers(text) {
  const players = [];
  for (const line of (text || '').split('\n')) {
    // Strict (current Squad format), then lenient fallback.
    let m = line.match(/^ID: (\d+) \| Online IDs: EOS: ([0-9a-f]{32}) steam: (\d{17}) \| Name: (.+) \| Team ID: (\d+) \| Squad ID: (\d+|N\/A) \| Is Leader: (True|False) \| Role: ([A-Za-z0-9_]*)/);
    if (m) {
      players.push({
        id: Number(m[1]), eosID: m[2], steamID: m[3], name: m[4].trim(),
        teamID: m[5], squadID: m[6] !== 'N/A' ? m[6] : null,
        isLeader: m[7] === 'True', role: m[8],
      });
      continue;
    }
    if (!/^ID:\s*\d+\s*\|/.test(line)) continue;
    const get = (re) => { const mm = line.match(re); return mm ? mm[1].trim() : null; };
    const sq = get(/Squad ID:\s*([^|]+)/);
    players.push({
      id: Number(get(/^ID:\s*(\d+)/)),
      eosID: get(/EOS:\s*([0-9a-fA-F]+)/),
      steamID: get(/steam:\s*(\d{17})/) || get(/SteamID:\s*(\d{17})/),
      name: get(/Name:\s*([^|]+)/),
      teamID: get(/Team ID:\s*(\d+)/),
      squadID: sq && /^\d+$/.test(sq) ? sq : null,
      isLeader: /Is Leader:\s*True/i.test(line),
      role: get(/Role:\s*([^|]+?)\s*$/),
    });
  }
  return players;
}

function parseSquads(text) {
  const squads = [];
  let teamID = null, teamName = null;
  for (const line of (text || '').split('\n')) {
    const side = line.match(/Team ID:\s*(1|2)\s*\((.+)\)/);
    if (side) { teamID = side[1]; teamName = side[2]; }
    const m = line.match(/^ID:\s*(\d+)\s*\|\s*Name:\s*(.+?)\s*\|\s*Size:\s*(\d+)\s*\|\s*Locked:\s*(True|False)/i);
    if (!m) continue;
    const creator = line.match(/Creator Name:\s*(.+?)\s*\|/);
    squads.push({
      squadID: m[1], name: m[2].trim(), size: Number(m[3]),
      locked: /true/i.test(m[4]), teamID, teamName,
      creatorName: creator ? creator[1] : null,
    });
  }
  return squads;
}

function parseCurrentMap(text) {
  const m = (text || '').match(/Current level is (.*), layer is (.*)/);
  return m ? { level: m[1].trim(), layer: m[2].trim() } : { level: null, layer: null };
}

function parseNextMap(text) {
  const m = (text || '').match(/Next level is (.*), layer is (.*)/);
  if (!m) return { level: null, layer: null };
  return {
    level: m[1].trim() !== '' ? m[1].trim() : null,
    layer: m[2].trim() !== 'To be voted' ? m[2].trim() : null,
  };
}

function parseServerInfo(text) {
  try {
    const start = (text || '').indexOf('{');
    const end = (text || '').lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const r = JSON.parse(text.slice(start, end + 1));
    const mapName = r.MapName_s || '';
    const strip = (s) => (s && mapName ? s.replace(new RegExp(mapName, 'i'), '').trim() : (s || null));
    return {
      serverName: r.ServerName_s || null,
      maxPlayers: parseInt(r.MaxPlayers || r.PlayerReserveCount_I || 0) || null,
      playerCount: parseInt(r.PlayerCount_I || 0) || 0,
      publicQueue: parseInt(r.PublicQueue_I || 0) || 0,
      reservedQueue: parseInt(r.ReservedQueue_I || 0) || 0,
      publicQueueLimit: parseInt(r.PublicQueueLimit_I || 0) || 0,
      map: mapName || null,
      layer: mapName || null,
      gameMode: r.GameMode_s || null,
      nextLayer: r.NextLayer_s || null,
      teamOne: strip(r.TeamOne_s) || null,
      teamTwo: strip(r.TeamTwo_s) || null,
      matchTimeout: parseInt(r.MatchTimeout_d || 0) || null,
      gameVersion: r.GameVersion_s || null,
      raw: r,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { SquadRcon, parsePlayers, parseSquads, parseServerInfo, parseCurrentMap, parseNextMap };
