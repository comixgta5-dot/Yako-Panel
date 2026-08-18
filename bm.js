'use strict';

/**
 * BattleMetrics data source (public API, no key needed for basic reads).
 * Used as a fallback when RCON isn't connected, so the panel can still show
 * live online count, current map and the player list for a server.
 * Docs: https://www.battlemetrics.com/developers/documentation
 */

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'YAKO-HUB-Panel/1.0' } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        if (r.statusCode >= 400) return reject(new Error('BM HTTP ' + r.statusCode));
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('BM timeout')); });
  });
}

class BattleMetrics {
  constructor() { this.cache = new Map(); }

  async getServer(id) {
    const c = this.cache.get(id);
    if (c && Date.now() - c.at < 20000) return c.data;
    const j = await fetchJSON(`https://api.battlemetrics.com/servers/${id}?include=player`);
    const a = (j.data && j.data.attributes) || {};
    const det = a.details || {};
    const players = (j.included || []).filter((x) => x.type === 'player')
      .map((x) => (x.attributes && x.attributes.name) || '').filter(Boolean).sort((x, y) => x.localeCompare(y));
    const data = {
      id,
      name: a.name || null,
      players: a.players != null ? a.players : 0,
      maxPlayers: a.maxPlayers != null ? a.maxPlayers : null,
      status: a.status || 'unknown',
      map: det.map || null,
      gameMode: det.gameMode || det.squad_playStyle || null,
      playerNames: players,
    };
    this.cache.set(id, { at: Date.now(), data });
    return data;
  }

  async search(term) {
    const j = await fetchJSON(`https://api.battlemetrics.com/servers?filter[game]=squad&filter[search]=${encodeURIComponent(term)}&page[size]=5`);
    return (j.data || []).map((s) => ({ id: s.id, name: s.attributes && s.attributes.name }));
  }
}

module.exports = { BattleMetrics };
