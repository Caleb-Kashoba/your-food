'use strict';
/**
 * Outils du moteur de simulation : connexion, horloge simulée, identités (administratrice, client, anonyme),
 * générateur aléatoire reproductible, dates, journal des cas et des mesures.
 */
const { Client } = require('pg');

const CFG = {
  host: process.env.SIM_HOST || '127.0.0.1',
  port: Number(process.env.SIM_PORT || 55432),
  user: process.env.SIM_USER || 'user',
  password: process.env.SIM_PASSWORD || 'password',
  database: process.env.SIM_DB || 'fusion_sim'
};

// ─── Dates (calendrier grégorien, jours « AAAA-MM-JJ ») ───
const parse = (d) => new Date(`${d}T12:00:00Z`);
const fmt = (date) => date.toISOString().slice(0, 10);
const addDays = (d, n) => fmt(new Date(parse(d).getTime() + n * 86400000));
const isoDow = (d) => ((parse(d).getUTCDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche
const isWeekday = (d) => isoDow(d) <= 5;
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const nextMonday = (d) => addDays(d, 8 - isoDow(d));
const DAY_FR = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// ─── Hasard reproductible ───
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = { next };
  r.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  r.pick = (list) => list[Math.floor(next() * list.length)];
  r.chance = (p) => next() < p;
  r.shuffle = (list) => { const l = [...list]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
  return r;
}

const pad = (n) => String(n).padStart(2, '0');
const hms = (seconds) => `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
const toSec = (t) => { const [h, m, s = 0] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };

// ─── Journal ───
class Journal {
  constructor() {
    this.cases = [];        // cas de test nommés (attendu / constaté)
    this.violations = [];   // règles d'invariant violées
    this.days = [];         // résumé par jour
    this.timings = {};      // mesures de durée (ms)
    this.counters = {};     // compteurs d'actions
    this.findings = [];     // anomalies relevées pendant la simulation
  }
  count(name, n = 1) { this.counters[name] = (this.counters[name] || 0) + n; }
  time(name, ms) { (this.timings[name] ||= []).push(ms); }
  caseResult(id, area, title, expected, actual, ok, day) {
    this.cases.push({ id, area, title, expected, actual: String(actual).slice(0, 300), ok: Boolean(ok), day });
    if (!ok) this.findings.push({ kind: 'cas', id, title, expected, actual: String(actual).slice(0, 300), day });
  }
  violation(rule, day, detail) {
    this.violations.push({ rule, day, detail: String(detail).slice(0, 400) });
  }
}

class Sim {
  constructor(db, journal) {
    this.db = db;
    this.j = journal;
    this.now = { day: null, time: null };
  }

  /** Règle l'horloge simulée (heure de Kinshasa, UTC+1) */
  async clock(day, time, db = this.db) {
    await db.query("select set_config('app.sim_now', $1, false)", [`${day}T${time}+01:00`]);
    if (db === this.db) this.now = { day, time };
  }

  /** Exécute `fn` avec l'identité d'un utilisateur Supabase (ou anonyme), dans une transaction */
  async as(uid, fn, role = 'authenticated', db = this.db) {
    const started = Date.now();
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role }),
        uid || ''
      ]);
      await db.query(`set local role ${role}`);
      const value = await fn(db);
      await db.query('commit');
      return { ok: true, value, ms: Date.now() - started };
    } catch (error) {
      await db.query('rollback').catch(() => undefined);
      return { ok: false, msg: error.message, detail: error.detail, ms: Date.now() - started };
    }
  }

  anon(fn) { return this.as(null, fn, 'anon'); }
  service(fn) { return this.as(null, fn, 'service_role'); }

  /** Requête en tant que propriétaire (hors sécurité) : préparation des données et contrôles d'invariants */
  q(sql, params) { return this.db.query(sql, params).then((r) => r.rows); }
  async one(sql, params) { return (await this.q(sql, params))[0]; }

  async rpc(uid, name, args = [], opts = {}) {
    const marks = args.map((_, i) => `$${i + 1}`).join(', ');
    const res = await this.as(uid, (db) => db.query(`select public.${name}(${marks}) as r`, args).then((r) => r.rows[0].r), opts.role || 'authenticated', opts.db || this.db);
    if (opts.name) this.j.time(opts.name, res.ms);
    return res;
  }

  async newConnection() {
    const c = new Client(CFG);
    await c.connect();
    if (this.now.day) await this.clock(this.now.day, this.now.time, c);
    return c;
  }
}

module.exports = { CFG, Client, Sim, Journal, rng, parse, fmt, addDays, isoDow, isWeekday, range, nextMonday, DAY_FR, pad, hms, toSec };
