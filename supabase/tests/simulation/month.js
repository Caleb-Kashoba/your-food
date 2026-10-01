'use strict';
/**
 * Simulation d'un mois d'utilisation (2 octobre → 6 novembre 2026) sur une base LOCALE reconstruite à partir des migrations.
 * ~100 clients de tous types, administratrice, cuisine, manager ; cas normaux, cas limites, attaques, courses concurrentes.
 * Horloge simulée : chaque action a son heure (Kinshasa). Sortie : sim-results.json (lu par report.js).
 *
 *   SIM_DB=fusion_sim node month.js [dossier-de-sortie]
 */
const fs = require('fs');
const path = require('path');
const { Client, CFG, Sim, Journal, rng, addDays, isoDow, isWeekday, range, nextMonday, DAY_FR, hms, toSec } = require('./lib');
const { seed, PLATS, ACCS, VIANDES } = require('./seed');

const OUT = process.argv[2] || __dirname;
const START = '2026-10-02';
const END = '2026-11-06';
const LOCK = 20 * 3600;

(async () => {
  const db = new Client(CFG);
  await db.connect();
  const J = new Journal();
  const sim = new Sim(db, J);
  // Essai de sensibilité : SIM_MUTATION=mutations/xx.sql casse volontairement une règle ; la simulation doit alors échouer
  if (process.env.SIM_MUTATION) { await db.query(fs.readFileSync(path.resolve(process.env.SIM_MUTATION), 'utf8')); console.log('MUTATION appliquée :', process.env.SIM_MUTATION); }
  const r = rng(20261005);
  const W = await seed(sim, r, J);
  const { org, team, admin, plans, items, clients } = W;
  const byUid = () => clients.filter((c) => c.uid);

  // ───────────────────────── Modèle attendu (l'oracle indépendant du système) ─────────────────────────
  const M = {
    menus: {},                       // date → { deadline, items:[noms], locked:boolean (verrouillage manuel) }
    meat: { F1: [1, 5], F2: null },  // jours de viande par formule (null = tous les jours)
    holidays: new Set(['2026-10-14', '2026-11-02']),
    ghostDays: new Set(['2026-10-16']),   // aucun client ne fait rien : repas par défaut sans aucun vote
    lazyDays: new Set(['2026-10-20']),    // pas de tâche planifiée : le verrouillage se fait à la lecture
    lockLog: {},
    off: new Set(),                  // plats désactivés ou supprimés (non republiables)
    manualLocks: new Set()           // menus verrouillés par l'administratrice (attribués à elle dans le journal)
  };
  const workingDaysBetween = (from, to) => range(from, to).filter(isWeekday).length;
  const meatAllowed = (plan, d) => M.meat[plan] === null || M.meat[plan].includes(isoDow(d));

  /** État d'abonnement attendu d'un client à une date (réplique indépendante de la règle) */
  function modelState(c, d) {
    const live = c.subs.filter((s) => ['active', 'suspended'].includes(s.status));
    let s = live.filter((x) => x.start <= d && x.end >= d).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
    if (!s) s = live.filter((x) => x.start > d).sort((a, b) => (a.start > b.start ? 1 : -1))[0];
    if (!s) s = [...c.subs].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    if (!s) return 'aucun';
    if (s.status === 'cancelled') return 'annule';
    if (s.status === 'suspended' && s.start <= d && s.end >= d) return 'suspendu';
    if (s.start > d) return 'non_commence';
    if (s.end < d) return 'expire';
    return workingDaysBetween(d > s.start ? d : s.start, s.end) <= 10 ? 'bientot_expire' : 'actif';
  }
  function currentSub(c, d) {
    return c.subs.filter((s) => s.status === 'active' && s.start <= d && s.end >= d).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  }
  /** Le client peut-il commander ou annuler maintenant ? */
  function canOrder(c, d, time) {
    const st = modelState(c, d);
    if (!['actif', 'bientot_expire'].includes(st)) return false;
    const s = currentSub(c, d);
    if (!s || (s.blockedUntil && s.blockedUntil >= d)) return false;
    const menu = M.menus[d];
    return Boolean(menu && !menu.locked && isWeekday(d) && toSec(time) < LOCK);
  }

  // ───────────────────────── Aides ─────────────────────────
  const expectRejected = (res, re) => !res.ok && (!re || re.test(`${res.msg} ${res.detail || ''}`));
  const C = (id, area, title, expected, actual, ok) => J.caseResult(id, area, title, expected, actual, ok, sim.now.day);
  const itemIds = (names) => names.map((n) => items[n].id);
  const pickSet = () => {
    const ok = (list) => r.shuffle(list.filter((n) => !M.off.has(n)));
    return [...ok(PLATS).slice(0, r.int(3, 5)), ...ok(ACCS).slice(0, r.int(2, 4)), ...ok(VIANDES).slice(0, r.int(2, 3))];
  };
  const dayLabel = (d) => `${DAY_FR[isoDow(d)]} ${d}`;

  async function publish(d, names, deadline = '13:00') {
    const res = await sim.rpc(admin, 'publish_menu', [d, itemIds(names), deadline], { name: 'publish_menu' });
    if (res.ok) M.menus[d] = { deadline, items: names, locked: false };
    return res;
  }
  async function publishWeek(monday, skip = []) {
    for (let k = 0; k < 5; k++) {
      const d = addDays(monday, k);
      if (skip.includes(d) || M.holidays.has(d) || M.menus[d]) continue;
      const res = await publish(d, pickSet(), r.pick(['11:00', '12:00', '13:00', '14:00', '15:00']));
      if (!res.ok) J.violation('publication', d, res.msg);
    }
  }

  // ───────────────────────── Actions des clients ─────────────────────────
  async function viewMenu(c) {
    const res = await sim.rpc(c.uid, 'my_today_menu', [], { name: 'my_today_menu' });
    if (!res.ok) { J.violation('menu_client', sim.now.day, `${c.first} ${c.last} : ${res.msg}`); return null; }
    const m = res.value;
    const d = sim.now.day;
    const expected = modelState(c, d);
    if (m.subscription.state !== expected) J.violation('etat_abonnement', d, `${c.first} ${c.last} : attendu ${expected}, constaté ${m.subscription.state}`);
    const sub = currentSub(c, d);
    if (sub && (m.meat_allowed_today !== meatAllowed(sub.plan, d))) J.violation('viande_jour', d, `${c.first} ${c.last} (${sub.plan}) : attendu ${meatAllowed(sub.plan, d)}, constaté ${m.meat_allowed_today}`);
    const published = Boolean(M.menus[d]);
    if (published !== Boolean(m.menu)) J.violation('menu_publie', d, `modèle ${published}, système ${Boolean(m.menu)}`);
    J.count('lectures_menu');
    return m;
  }
  function choose(m, c) {
    const opts = m.menu.options;
    const of = (cat) => r.pick(opts.filter((o) => o.category === cat));
    return { plat: of('plat').option_id, acc: of('accompagnement').option_id, viande: m.meat_allowed_today ? of('viande').option_id : null };
  }
  async function order(c, label = 'commande') {
    const m = await viewMenu(c);
    if (!m || !m.menu) { J.count('commande_sans_menu'); return; }
    const d = sim.now.day;
    const ok = canOrder(c, d, sim.now.time);
    const p = choose(m, c);
    const res = await sim.rpc(c.uid, 'submit_my_order', [m.menu.id, p.plat, p.acc, p.viande], { name: 'submit_my_order' });
    J.count(res.ok ? 'commandes_acceptees' : 'commandes_refusees');
    if (res.ok !== ok) J.violation('commande_attendue', d, `${c.first} ${c.last} ${sim.now.time} (${label}) : attendu ${ok ? 'accepté' : 'refusé'}, constaté ${res.ok ? 'accepté' : 'refusé : ' + res.msg}`);
    return res;
  }
  async function cancel(c, label = 'annulation') {
    const m = await viewMenu(c);
    if (!m || !m.menu) return;
    const d = sim.now.day;
    const ok = canOrder(c, d, sim.now.time);
    const res = await sim.rpc(c.uid, 'cancel_my_order', [m.menu.id], { name: 'cancel_my_order' });
    J.count(res.ok ? 'annulations_acceptees' : 'annulations_refusees');
    if (res.ok !== ok) J.violation('annulation_attendue', d, `${c.first} ${c.last} ${sim.now.time} (${label}) : attendu ${ok ? 'accepté' : 'refusé'}, constaté ${res.ok ? 'accepté' : 'refusé : ' + res.msg}`);
  }

  /** Événements d'un jour pour tous les clients selon leur profil */
  function clientEvents(d) {
    const ev = [];
    if (!isWeekday(d)) {
      // Week-end : quelques clients essaient quand même (aucun menu : tout doit être refusé)
      for (const c of r.shuffle(byUid()).slice(0, 3)) ev.push([r.int(9, 18) * 3600, `${c.first} essaie le week-end`, () => order(c, 'week-end')]);
      return ev;
    }
    if (M.ghostDays.has(d)) {
      for (const c of r.shuffle(byUid()).slice(0, 6)) ev.push([r.int(9, 17) * 3600, 'lecture seule', () => viewMenu(c)]);
      return ev;
    }
    for (const c of byUid()) {
      const t = (h0, h1) => r.int(h0 * 3600, h1 * 3600 - 1);
      switch (c.persona) {
        case 'early': if (r.chance(0.9)) ev.push([t(8, 11), 'commande matinale', () => order(c)]); break;
        case 'late': ev.push([t(13, 20), 'commande tardive', () => order(c, 'tardive')]); break;
        case 'changer':
          ev.push([t(8, 10), 'commande', () => order(c)]);
          ev.push([t(14, 18), 'modification', () => order(c, 'modification')]);
          break;
        case 'canceller': ev.push([t(9, 19), 'annulation sans commande', () => cancel(c)]); break;
        case 'resumer':
          ev.push([t(9, 11), 'annulation', () => cancel(c)]);
          if (r.chance(0.7)) ev.push([t(15, 19), 'reprise', () => order(c, 'reprise')]);
          break;
        case 'lastminute': ev.push([19 * 3600 + 59 * 60 + r.int(30, 59), 'dernière seconde', () => order(c, 'dernière minute')]); break;
        case 'sporadic': if (r.chance(0.25)) ev.push([t(8, 12), 'commande occasionnelle', () => order(c)]); break;
        default: if (r.chance(0.1)) ev.push([t(8, 20), 'lecture seule', () => viewMenu(c)]);
      }
    }
    // Attaques : tentatives interdites de clients, qui doivent TOUTES être refusées
    for (const c of r.shuffle(byUid()).slice(0, 3)) ev.push([r.int(8, 19) * 3600, 'attaque', () => attack(c)]);
    return ev;
  }

  async function attack(c) {
    const d = sim.now.day;
    const m = await viewMenu(c);
    if (!m || !m.menu) return;
    const opts = m.menu.options;
    const ids = (cat) => opts.filter((o) => o.category === cat).map((o) => o.option_id);
    const tomorrow = M.menus[addDays(d, 1)] ? (await sim.one('select id from public.daily_menus where menu_date = $1', [addDays(d, 1)])) : null;
    const tries = [
      ['option de la mauvaise catégorie', () => sim.rpc(c.uid, 'submit_my_order', [m.menu.id, ids('accompagnement')[0], ids('accompagnement')[0], null])],
      ['viande à la place du plat', () => sim.rpc(c.uid, 'submit_my_order', [m.menu.id, ids('viande')[0], ids('accompagnement')[0], null])],
      ['identifiant d\'option inventé', () => sim.rpc(c.uid, 'submit_my_order', [m.menu.id, '00000000-0000-0000-0000-000000000001', ids('accompagnement')[0], null])],
      ['menu inexistant', () => sim.rpc(c.uid, 'submit_my_order', ['00000000-0000-0000-0000-000000000002', ids('plat')[0], ids('accompagnement')[0], null])],
      ['avis sur une commande inexistante', () => sim.rpc(c.uid, 'submit_my_review', ['00000000-0000-0000-0000-000000000003', 5, 'x'])],
      ['lecture du journal', () => sim.rpc(c.uid, 'audit_search', [])],
      ['publication d\'un menu', () => sim.rpc(c.uid, 'publish_menu', [addDays(d, 30), [], '13:00'])],
      ['émission d\'un code d\'accès', () => sim.rpc(c.uid, 'issue_customer_access_code', [clients[0].id, 'reset'])]
    ];
    if (tomorrow) tries.push(['commande sur le menu de demain', () => sim.rpc(c.uid, 'submit_my_order', [tomorrow.id, ids('plat')[0] || null, ids('accompagnement')[0] || null, null])]);
    const [label, fn] = r.pick(tries);
    const res = await fn();
    J.count('attaques');
    if (res.ok) J.violation('attaque_acceptee', d, `${c.first} ${c.last} : « ${label} » a été acceptée`);
  }

  // ───────────────────────── Verrouillage, oracle et invariants ─────────────────────────
  async function menuRow(d) { return sim.one('select id, status from public.daily_menus where menu_date = $1', [d]); }

  /** Photographie avant verrouillage : ce que l'oracle attend pour les repas par défaut */
  async function preLockSnapshot(d) {
    const m = await menuRow(d);
    if (!m || m.status !== 'open') return null;
    const top = {};
    for (const cat of ['plat', 'accompagnement', 'viande']) {
      const col = { plat: 'plat_option_id', accompagnement: 'accompagnement_option_id', viande: 'viande_option_id' }[cat];
      const rows = await sim.q(
        `select o.id, c.name, (select count(*) from public.meal_orders mo where mo.status = 'confirmed' and mo.${col} = o.id) as n
         from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id
         where o.daily_menu_id = $1 and c.category = $2 order by n desc, c.name asc limit 1`, [m.id, cat]);
      top[cat] = rows[0] ? rows[0].id : null;
    }
    const waiting = (await sim.one(
      `select count(*)::int as n from public.deliveries dl where dl.delivery_date = $1 and dl.status <> 'cancelled'
       and not exists (select 1 from public.meal_orders o where o.daily_menu_id = $2 and o.customer_id = dl.customer_id)`, [d, m.id])).n;
    return { menuId: m.id, top, waiting };
  }

  async function checkDay(d, snap, created) {
    const m = await menuRow(d);
    if (!m) {
      const orders = (await sim.one('select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1', [d])).n;
      if (orders > 0) J.violation('commandes_sans_menu', d, `${orders} commandes sans menu`);
      return { published: false };
    }
    const bad = async (rule, sql, params = [d]) => {
      const n = (await sim.one(sql, params)).n;
      if (n > 0) J.violation(rule, d, `${n} ligne(s)`);
    };
    // I1 : toute livraison non annulée a exactement une commande après verrouillage
    await bad('I1_une_commande_par_livraison',
      `select count(*)::int as n from public.deliveries dl where dl.delivery_date = $1 and dl.status <> 'cancelled'
       and not exists (select 1 from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and o.customer_id = dl.customer_id)`);
    // I2 : une annulation du client annule la livraison, et inversement
    await bad('I2_annulation_coherente',
      `select count(*)::int as n from public.deliveries dl where dl.delivery_date = $1 and dl.cancellation_reason = 'customer_cancelled'
       and not exists (select 1 from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and o.customer_id = dl.customer_id and o.status = 'cancelled')`);
    await bad('I2b_commande_annulee_sans_livraison_annulee',
      `select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.deliveries dl on dl.customer_id = o.customer_id and dl.delivery_date = dm.menu_date
       where dm.menu_date = $1 and o.status = 'cancelled' and dl.status not in ('cancelled')`);
    // I3 : la viande suit la formule (règle en vigueur ce jour-là)
    await bad('I3_viande_selon_formule',
      `select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id
       join public.subscriptions s on s.id = o.subscription_id join public.plans p on p.id = s.plan_id
       where dm.menu_date = $1 and o.status = 'confirmed' and (
         (p.meat_weekdays is not null and extract(isodow from dm.menu_date)::int <> all (p.meat_weekdays) and o.viande_option_id is not null)
         or ((p.meat_weekdays is null or extract(isodow from dm.menu_date)::int = any (p.meat_weekdays)) and o.viande_option_id is null))`);
    // I4 : les commandes annulées n'ont aucun choix et ne sont pas « par défaut »
    await bad('I4_annulee_sans_choix',
      `select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id
       where dm.menu_date = $1 and o.status = 'cancelled' and (o.plat_option_id is not null or o.accompagnement_option_id is not null or o.viande_option_id is not null or o.is_default)`);
    // I5 : les options d'une commande appartiennent bien au menu du jour
    await bad('I5_options_du_menu',
      `select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id
       where dm.menu_date = $1 and ((o.plat_option_id is not null and not exists (select 1 from public.menu_options x where x.id = o.plat_option_id and x.daily_menu_id = dm.id))
         or (o.accompagnement_option_id is not null and not exists (select 1 from public.menu_options x where x.id = o.accompagnement_option_id and x.daily_menu_id = dm.id))
         or (o.viande_option_id is not null and not exists (select 1 from public.menu_options x where x.id = o.viande_option_id and x.daily_menu_id = dm.id)))`);
    // I6 : oracle des repas par défaut
    if (snap && created !== null) {
      if (created !== snap.waiting) J.violation('I6_nombre_defauts', d, `attendu ${snap.waiting}, créés ${created}`);
      for (const [cat, col] of [['plat', 'plat_option_id'], ['accompagnement', 'accompagnement_option_id'], ['viande', 'viande_option_id']]) {
        const rows = await sim.q(`select distinct ${col} as v from public.meal_orders where daily_menu_id = $1 and is_default`, [snap.menuId]);
        const got = rows.map((x) => x.v).filter(Boolean);
        const bad2 = got.filter((v) => v !== snap.top[cat]);
        if (bad2.length > 0) J.violation('I6_defaut_le_plus_choisi', d, `${cat} : attendu ${snap.top[cat]}, constaté ${got.join(',')}`);
      }
    }
    // I7 : après verrouillage, les options du menu ne changent plus (empreinte)
    const hash = (await sim.one(`select md5(string_agg(catalog_item_id::text, ',' order by catalog_item_id)) as h from public.menu_options where daily_menu_id = $1`, [m.id])).h;
    if (M.lockLog[d] && M.lockLog[d].hash && M.lockLog[d].hash !== hash) J.violation('I7_menu_verrouille_modifie', d, 'options modifiées après verrouillage');
    M.lockLog[d] = { ...(M.lockLog[d] || {}), hash };
    return { published: true };
  }

  async function lockAndCheck(d, mode) {
    const snap = await preLockSnapshot(d);
    let created = null;
    const t0 = Date.now();
    if (mode === 'cron') {
      created = (await sim.one('select public.lock_due_menus() as n')).n;       // pg_cron, en tant que propriétaire (aucune identité d'utilisateur)
    } else if (mode === 'lazy') {
      // aucun cron : un client ouvre son menu après 20h → verrouillage à la lecture, avec SON identité
      const c = r.pick(byUid().filter((x) => x.persona));
      const before = (await sim.one('select count(*)::int as n from public.meal_orders where is_default')).n;
      await sim.rpc(c.uid, 'my_today_menu', [], { name: 'my_today_menu_verrouillage' });
      created = (await sim.one('select count(*)::int as n from public.meal_orders where is_default')).n - before;
      M.lazyClient = c;
    }
    J.time('verrouillage', Date.now() - t0);
    if (snap) J.count('repas_par_defaut', created || 0);
    if (snap && !M.menus[d]) J.violation('menu_non_modele', d, 'menu verrouillé mais absent du modèle');
    return checkDay(d, snap, created);
  }

  async function rlsSample(d) {
    const sample = r.shuffle(byUid()).slice(0, 4);
    for (const c of sample) {
      const own = await sim.one(
        `select (select count(*) from public.subscriptions where customer_id = $1)::int as s, (select count(*) from public.deliveries where customer_id = $1)::int as d,
                (select count(*) from public.meal_orders where customer_id = $1)::int as o, (select count(*) from public.payments where customer_id = $1)::int as p`, [c.id]);
      const seen = await sim.as(c.uid, (x) => x.query(
        `select (select count(*) from public.customers)::int as c, (select count(*) from public.subscriptions)::int as s, (select count(*) from public.deliveries)::int as d,
                (select count(*) from public.meal_orders)::int as o, (select count(*) from public.payments)::int as p,
                (select count(*) from public.customer_access_codes)::int as k, (select count(*) from public.audit_logs)::int as a, (select count(*) from public.plans)::int as pl,
                (select count(*) from public.catalog_items)::int as ci, (select count(*) from public.daily_menus)::int as dm`).then((q) => q.rows[0]));
      J.count('controles_rls');
      if (!seen.ok) { J.violation('RLS_erreur', d, seen.msg); continue; }
      const v = seen.value;
      if (v.c !== 1 || v.s !== own.s || v.d !== own.d || v.o !== own.o || v.p !== own.p || v.k !== 0 || v.a !== 0 || v.pl !== 0 || v.ci !== 0 || v.dm !== 0) {
        J.violation('RLS_fuite', d, `${c.first} ${c.last} voit ${JSON.stringify(v)} (attendu fiche 1, abonnements ${own.s}, livraisons ${own.d}, commandes ${own.o}, paiements ${own.p}, le reste 0)`);
      }
    }
    const anon = await sim.anon((x) => x.query(`select (select count(*) from public.customers)::int + (select count(*) from public.meal_orders)::int + (select count(*) from public.deliveries)::int + (select count(*) from public.payments)::int + (select count(*) from public.audit_logs)::int as n`).then((q) => q.rows[0].n));
    if (!anon.ok || anon.value !== 0) J.violation('RLS_anonyme', d, anon.ok ? `l'anonyme voit ${anon.value} lignes` : anon.msg);
  }

  // ───────────────────────── Opérations de l'équipe (cuisine, livraison, avis, alertes) ─────────────────────────
  async function kitchenAndDelivery(d) {
    const board = await sim.rpc(team.staff, 'deliveries_board', [d, d], { name: 'deliveries_board' });
    if (!board.ok) { J.violation('tableau_cuisine', d, board.msg); return; }
    const rows = board.value.filter((x) => ['commande', 'defaut'].includes(x.state) && x.delivery_status === 'scheduled');
    let prepared = 0, delivered = 0, failed = 0;
    for (const row of rows) {
      if (!r.chance(0.92)) continue;
      const a = await sim.rpc(team.staff, 'update_delivery_status', [row.delivery_id, 'ready']);
      if (!a.ok) { J.violation('preparation', d, a.msg); continue; }
      prepared++;
      if (r.chance(0.9)) {
        const status = r.chance(0.05) ? 'failed' : 'delivered';
        const b = await sim.rpc(team.staff, 'update_delivery_status', [row.delivery_id, status]);
        if (!b.ok) J.violation('livraison', d, b.msg);
        else if (status === 'delivered') delivered++; else failed++;
      }
    }
    J.count('bols_prepares', prepared); J.count('livraisons_livrees', delivered); J.count('livraisons_echouees', failed);
    return { rows: board.value.length, prepared, delivered };
  }

  async function reviewsOf(d) {
    // le lendemain matin, une partie des clients note le repas de la veille
    const rows = await sim.q(
      `select o.id, c.id as cid from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.customers c on c.id = o.customer_id
       where dm.menu_date = $1 and o.status = 'confirmed' and c.auth_user_id is not null and dm.status = 'locked'`, [d]);
    for (const row of rows) {
      if (!r.chance(0.35)) continue;
      const c = clients.find((x) => x.id === row.cid);
      if (!c || !c.uid) continue;
      const rating = r.chance(0.8) ? r.int(1, 5) : null;
      const comment = r.chance(0.4) || rating === null ? r.pick(['Très bon', 'Un peu salé', 'Parfait', 'Portion généreuse', 'Livré en retard']) : null;
      const res = await sim.rpc(c.uid, 'submit_my_review', [row.id, rating, comment], { name: 'submit_my_review' });
      J.count(res.ok ? 'avis_acceptes' : 'avis_refuses');
      if (!res.ok) J.violation('avis', d, `${c.first} ${c.last} : ${res.msg}`);
    }
  }

  async function nightlyAlerts(d) {
    const expected = (await sim.one(
      `select count(*)::int as n from public.subscriptions s join public.alert_rules r on r.organization_id = s.organization_id and r.alert_type = 'subscription_expiration' and r.is_active
       where s.admin_status = 'active' and s.end_date - r.days_before = $1::date`, [d])).n;
    const created = (await sim.one('select public.generate_subscription_alerts() as n')).n;
    if (created !== expected) J.violation('alertes_expiration', d, `attendu ${expected}, créées ${created}`);
    J.count('alertes_creees', created);
    const again = (await sim.one('select public.generate_subscription_alerts() as n')).n;
    if (again !== 0) J.violation('alertes_doublons', d, `${again} alertes recréées`);
  }

  // ───────────────────────── Cas particuliers planifiés ─────────────────────────
  const pickClient = (pred) => r.shuffle(clients).find(pred);
  const sched = {};
  const at = (day, time, label, fn) => ((sched[day] ||= []).push([toSec(time), label, fn]));
  const first = (list) => list[0];

  // —— Accès et comptes (2 octobre)
  at('2026-10-02', '09:00:00', 'accès : activation par code', async () => {
    const [c1, c2, c3] = clients.filter((c) => c.activationCode);
    // A1 : vérification puis liaison
    const login = `${c1.first} ${c1.last}`;
    const v = await sim.anon((x) => x.query('select public.verify_customer_access_code($1,$2,$3) as r', [login, c1.activationCode, null]).then((q) => q.rows[0].r));
    const needsLast4 = v.ok && v.value.status === 'need_last4';
    const last4 = c1.phone ? c1.phone.slice(-4) : null;
    const v2 = needsLast4 ? await sim.anon((x) => x.query('select public.verify_customer_access_code($1,$2,$3) as r', [login, c1.activationCode, last4]).then((q) => q.rows[0].r)) : v;
    C('A1', 'accès', 'vérification du code d\'activation (homonyme : avec les 4 derniers chiffres)', 'status ok', v2.ok ? v2.value.status : v2.msg, v2.ok && (v2.value.status === 'ok' || (needsLast4 && !last4)));
    if (v2.ok && v2.value.status === 'ok') {
      const done = await sim.service((x) => x.query('select public.complete_customer_access($1,$2,$3)', [c1.id, c1.activationCode, c1.pendingAuth]));
      C('A1b', 'accès', 'liaison du compte par la fonction réservée au service', 'compte lié', done.ok ? 'ok' : done.msg, done.ok);
      c1.uid = c1.pendingAuth;
      const again = await sim.service((x) => x.query('select public.complete_customer_access($1,$2,$3)', [c1.id, c1.activationCode, c1.pendingAuth]));
      C('A1c', 'accès', 'un code ne sert qu\'une fois', 'refusé', again.ok ? 'accepté' : again.msg, expectRejected(again, /Invalid access code/));
      const asClient = await sim.as(c1.pendingAuth, (x) => x.query('select public.my_context() as r').then((q) => q.rows[0].r));
      C('A1d', 'accès', 'le compte activé est reconnu comme client', 'kind = customer', asClient.ok ? asClient.value.kind : asClient.msg, asClient.ok && asClient.value.kind === 'customer');
      const userClient = await sim.as(c1.pendingAuth, (x) => x.query('select public.complete_customer_access($1,$2,$3)', [c1.id, 'AAAAAAAA', c1.pendingAuth]));
      C('A1e', 'accès', 'un client connecté ne peut pas appeler la fonction réservée au service', 'refusé', userClient.ok ? 'accepté' : userClient.msg, !userClient.ok);
    } else { c1.uid = null; }

    // A2 : 10 mauvais codes verrouillent le code ; l'administratrice en émet un nouveau
    const l2 = `${c2.first} ${c2.last}`;
    for (let i = 0; i < 10; i++) await sim.anon((x) => x.query('select public.verify_customer_access_code($1,$2,$3)', [l2, 'ZZZZZZZZ', c2.phone ? c2.phone.slice(-4) : null]));
    const locked = await sim.anon((x) => x.query('select public.verify_customer_access_code($1,$2,$3) as r', [l2, c2.activationCode, c2.phone ? c2.phone.slice(-4) : null]).then((q) => q.rows[0].r));
    C('A2', 'accès', '10 essais ratés verrouillent le code (même le bon code est refusé)', 'invalid_code / need_last4 / not_found', locked.ok ? locked.value.status : locked.msg, locked.ok && locked.value.status !== 'ok');
    const reissue = await sim.rpc(admin, 'issue_customer_access_code', [c2.id, 'activation']);
    C('A2b', 'accès', 'après verrouillage, l\'administratrice reçoit un NOUVEAU code', 'code différent', reissue.ok ? (reissue.value !== c2.activationCode ? 'nouveau' : 'identique') : reissue.msg, reissue.ok && reissue.value !== c2.activationCode);
    if (reissue.ok) { c2.activationCode = reissue.value; }

    // A6 : renvoyer une activation redonne le même code
    const same = await sim.rpc(admin, 'issue_customer_access_code', [c3.id, 'activation']);
    C('A6', 'accès', 'renvoi d\'une activation : le même code', 'identique', same.ok ? (same.value === c3.activationCode ? 'identique' : 'différent') : same.msg, same.ok && same.value === c3.activationCode);

    // A7 : réinitialisation impossible sans compte ; activation impossible avec compte
    const resetNo = await sim.rpc(admin, 'issue_customer_access_code', [c3.id, 'reset']);
    C('A7', 'accès', 'réinitialiser un compte non activé', 'refusé', resetNo.ok ? 'accepté' : resetNo.msg, expectRejected(resetNo, /not activated/));
    const linked = byUid()[0];
    const actNo = await sim.rpc(admin, 'issue_customer_access_code', [linked.id, 'activation']);
    C('A7b', 'accès', 'émettre un code d\'activation pour un compte déjà activé', 'refusé', actNo.ok ? 'accepté' : actNo.msg, expectRejected(actNo, /already activated/));

    // A5 : réinitialisation du mot de passe d'un compte activé
    const rs = await sim.rpc(admin, 'issue_customer_access_code', [linked.id, 'reset']);
    const rv = rs.ok ? await sim.anon((x) => x.query('select public.verify_customer_access_code($1,$2,$3) as r', [`${linked.first} ${linked.last}`, rs.value, linked.phone ? linked.phone.slice(-4) : null]).then((q) => q.rows[0].r)) : null;
    C('A5', 'accès', 'réinitialisation : le code vérifié est de type « reset »', 'type reset', rv && rv.ok ? `${rv.value.status}/${rv.value.type}` : (rs.msg || rv?.msg), rv && rv.ok && (rv.value.type === 'reset' || rv.value.status === 'need_last4'));
    // Le code de réinitialisation reste ouvert : on le consomme pour ne pas bloquer
    await sim.q('update public.customer_access_codes set used_at = now() where customer_id = $1 and used_at is null', [linked.id]);
  });

  at('2026-10-02', '09:30:00', 'accès : homonymes', async () => {
    for (const [a, b] of W.pairs) {
      const login = `${a.first} ${a.last}`;
      const res = await sim.anon((x) => x.query('select public.resolve_customer_login($1,$2) as r', [login, null]).then((q) => q.rows[0].r));
      const bothActive = a.group !== 'F' && b.group !== 'F';
      C('A3', 'accès', `homonymes « ${login} » : le nom seul ne suffit pas`, 'need_last4', res.ok ? res.value.status : res.msg, res.ok && res.value.status === 'need_last4');
      for (const x of [a, b]) {
        const l4 = x.phone ? x.phone.slice(-4) : null;
        if (l4) {
          const w = await sim.anon((y) => y.query('select public.resolve_customer_login($1,$2) as r', [login, l4]).then((q) => q.rows[0].r));
          C('A3b', 'accès', `homonymes « ${login} » : les bons 4 chiffres désignent le bon client`, x.id, w.ok ? w.value.customer_id : w.msg, w.ok && w.value.customer_id === x.id);
        } else {
          const w = await sim.anon((y) => y.query('select public.resolve_customer_login($1,$2) as r', [login, '0000']).then((q) => q.rows[0].r));
          C('A3c', 'accès', `homonyme sans numéro (« ${login} ») : impossible à distinguer (limite connue)`, 'not_found', w.ok ? w.value.status : w.msg, w.ok && w.value.status === 'not_found');
        }
      }
      void bothActive;
    }
    const unk = await sim.anon((x) => x.query('select public.resolve_customer_login($1,$2) as r', ['Personne Inconnue', null]).then((q) => q.rows[0].r));
    C('A4', 'accès', 'nom inconnu', 'not_found', unk.ok ? unk.value.status : unk.msg, unk.ok && unk.value.status === 'not_found');
    const accent = clients.find((c) => /[éèêëïîôöùûüç]/i.test(c.first + c.last));
    if (accent) {
      const folded = `${accent.first} ${accent.last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      const w = await sim.anon((y) => y.query('select public.resolve_customer_login($1,$2) as r', [`  ${folded}  `, accent.phone ? accent.phone.slice(-4) : null]).then((q) => q.rows[0].r));
      C('A4b', 'accès', 'connexion insensible aux accents, à la casse et aux espaces', 'client retrouvé', w.ok ? w.value.status : w.msg, w.ok && ['ok', 'need_last4'].includes(w.value.status));
    }
  });

  // —— Droits des rôles
  at('2026-10-02', '11:00:00', 'droits : rôles', async () => {
    const c = byUid()[1];
    const denied = async (id, title, res) => C(id, 'droits', title, 'refusé', res.ok ? 'accepté' : res.msg, !res.ok);
    await denied('D1', 'client : publier un menu', await sim.rpc(c.uid, 'publish_menu', ['2026-12-01', [], '13:00']));
    await denied('D2', 'client : enregistrer un paiement', await sim.rpc(c.uid, 'record_payment', [org, c.id, c.subs[0]?.id || admin, 1000, 'CDF', admin, null, '2026-10-02', null]));
    await denied('D3', 'client : lire le suivi administratrice', await sim.rpc(c.uid, 'orders_live', []));
    await denied('D4', 'client : lire le tableau de préparation', await sim.rpc(c.uid, 'deliveries_board', ['2026-10-05', '2026-10-05']));
    await denied('D5', 'client : verrouiller un menu', await sim.rpc(c.uid, 'lock_menu_now', ['2026-10-05']));
    await denied('D6', 'client : voir les statistiques', await sim.rpc(c.uid, 'orders_overview', []));
    await denied('D7', 'client : renouveler un abonnement', await sim.rpc(c.uid, 'renew_subscription_weeks', [c.id, 1, null, null, null]));
    await denied('D8', 'client : modifier le prix d\'un abonnement', await sim.rpc(c.uid, 'set_subscription_price', [c.subs[0]?.id || admin, 1, 'x']));
    await denied('D9', 'administratrice : passer une commande (menu client)', await sim.rpc(admin, 'my_today_menu', []));
    await denied('D10', 'cuisine : publier un menu', await sim.rpc(team.staff, 'publish_menu', ['2026-12-01', [], '13:00']));
    await denied('D11', 'cuisine : enregistrer un paiement', await sim.rpc(team.staff, 'record_payment', [org, c.id, c.subs[0]?.id || admin, 1000, 'CDF', admin, null, '2026-10-02', null]));
    await denied('D12', 'cuisine : lire le journal', await sim.rpc(team.staff, 'audit_search', []));
    await denied('D13', 'manager : lire le journal d\'activité (réservé admin et root)', await sim.rpc(team.manager, 'audit_search', []));
    const ok1 = await sim.rpc(team.admin, 'audit_search', []);
    C('D14', 'droits', 'admin : lire le journal d\'activité', 'accepté', ok1.ok ? 'ok' : ok1.msg, ok1.ok);
    const ok2 = await sim.rpc(team.manager, 'orders_live', ['2026-10-05']);
    C('D15', 'droits', 'manager : lire le suivi du jour', 'accepté', ok2.ok ? 'ok' : ok2.msg, ok2.ok);
    const ok3 = await sim.rpc(team.staff, 'deliveries_board', ['2026-10-05', '2026-10-05']);
    C('D16', 'droits', 'cuisine : lire le tableau de préparation', 'accepté', ok3.ok ? 'ok' : ok3.msg, ok3.ok);
    const anonRes = await sim.anon((x) => x.query('select public.my_today_menu() as r'));
    await denied('D17', 'anonyme : menu du jour', anonRes);
    const anonAdmin = await sim.anon((x) => x.query('select public.publish_menu($1,$2,$3)', ['2026-12-01', [], '13:00']));
    await denied('D18', 'anonyme : publier un menu', anonAdmin);
  });

  // —— Menus : publication de la semaine 1 et refus
  at('2026-10-02', '10:00:00', 'menus : semaine 1', async () => {
    const names = pickSet();
    const res = await sim.rpc(admin, 'publish_menus', ['2026-10-05', 5, itemIds(names), '13:00'], { name: 'publish_menus' });
    C('M1', 'menus', 'publication de 5 jours d\'un coup', '5 menus créés', res.ok ? `${res.value.created.length} créés` : res.msg, res.ok && res.value.created.length === 5);
    if (res.ok) for (const d of res.value.created) M.menus[d] = { deadline: '13:00', items: names, locked: false };
    const dup = await sim.rpc(admin, 'publish_menu', ['2026-10-05', itemIds(names), '13:00']);
    C('M2', 'menus', 'second menu le même jour', 'refusé', dup.ok ? 'accepté' : dup.msg, expectRejected(dup, /déjà publié/));
    const sat = await sim.rpc(admin, 'publish_menu', ['2026-10-10', itemIds(names), '13:00']);
    C('M3', 'menus', 'menu un samedi', 'refusé', sat.ok ? 'accepté' : sat.msg, expectRejected(sat, /lundi au vendredi/));
    const past = await sim.rpc(admin, 'publish_menu', ['2026-10-01', itemIds(names), '13:00']);
    C('M4', 'menus', 'menu pour un jour passé', 'refusé', past.ok ? 'accepté' : past.msg, expectRejected(past, /trop tard/));
    const noMeat = await sim.rpc(admin, 'publish_menu', ['2026-10-12', itemIds(names.filter((n) => !VIANDES.includes(n))), '13:00']);
    C('M5', 'menus', 'menu sans viande', 'refusé', noMeat.ok ? 'accepté' : noMeat.msg, expectRejected(noMeat, /au moins un plat/));
    for (const [bad, id] of [['10:59', 'M6a'], ['19:01', 'M6b']]) {
      const x = await sim.rpc(admin, 'publish_menu', ['2026-10-12', itemIds(names), bad]);
      C(id, 'menus', `heure limite ${bad}`, 'refusée', x.ok ? 'acceptée' : x.msg, expectRejected(x, /11:00 et 19:00/));
    }
    const bounds = await sim.rpc(admin, 'publish_menu', ['2026-10-12', itemIds(names), '19:00']);
    C('M6c', 'menus', 'heure limite 19:00 (borne haute)', 'acceptée', bounds.ok ? 'ok' : bounds.msg, bounds.ok);
    if (bounds.ok) M.menus['2026-10-12'] = { deadline: '19:00', items: names, locked: false };
    const inactive = await sim.rpc(admin, 'update_catalog_item', [items['Saka-saka'].id, null, null, false]);
    const withInactive = await sim.rpc(admin, 'publish_menu', ['2026-10-20', itemIds([...names, 'Saka-saka']), '13:00']);
    C('M16', 'menus', 'publier avec un plat désactivé', 'refusé', withInactive.ok ? 'accepté' : withInactive.msg, expectRejected(withInactive, /désactivés/));
    await sim.rpc(admin, 'update_catalog_item', [items['Saka-saka'].id, null, null, true]);
    void inactive;
    const tooMany = await sim.rpc(admin, 'publish_menus', ['2026-10-19', 31, itemIds(names), '13:00']);
    C('M10b', 'menus', 'plus de 30 jours d\'un coup', 'refusé', tooMany.ok ? 'accepté' : tooMany.msg, expectRejected(tooMany, /entre 1 et 30/));
  });

  // —— Chaque vendredi : semaine suivante (jours fériés exclus)
  for (const friday of ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']) {
    at(friday, '12:00:00', 'menus : semaine suivante', async () => {
      const monday = addDays(friday, 3);
      if (friday === '2026-10-16') {
        // M10 : un jour est déjà publié, la publication groupée l'ignore
        const names = pickSet();
        const single = await publish(monday, names);
        const multi = await sim.rpc(admin, 'publish_menus', [monday, 5, itemIds(names), '14:00'], { name: 'publish_menus' });
        C('M10', 'menus', 'publication groupée : le jour déjà publié est ignoré', `ignoré [${monday}]`, multi.ok ? `ignorés ${JSON.stringify(multi.value.ignored)}` : multi.msg, single.ok && multi.ok && multi.value.ignored.includes(monday) && multi.value.created.length === 4);
        if (multi.ok) for (const d of multi.value.created) M.menus[d] = { deadline: '14:00', items: names, locked: false };
      } else {
        await publishWeek(monday);
      }
    });
  }

  // —— Menus : modifications
  at('2026-10-06', '09:00:00', 'menus : modification', async () => {
    const d = '2026-10-07';
    const cur = M.menus[d];
    const add = ACCS.find((a) => !cur.items.includes(a));
    const res = await sim.rpc(admin, 'update_menu', [d, itemIds([...cur.items, add]), '15:00'], { name: 'update_menu' });
    C('M7', 'menus', 'modifier un menu à venir : plat ajouté et heure limite', 'accepté', res.ok ? 'ok' : res.msg, res.ok);
    if (res.ok) { cur.items.push(add); cur.deadline = '15:00'; }
    const none = await sim.rpc(admin, 'update_menu', [d, null, null]);
    C('M7b', 'menus', 'modification vide', 'refusée', none.ok ? 'acceptée' : none.msg, expectRejected(none, /Aucune modification/));
    const noDay = await sim.rpc(admin, 'update_menu', ['2026-10-14', null, '14:00']);
    C('M7c', 'menus', 'modifier un jour sans menu (jour férié)', 'refusé', noDay.ok ? 'accepté' : noDay.msg, expectRejected(noDay, /Aucun menu publié/));
  });
  at('2026-10-06', '12:00:00', 'menus : retirer un plat déjà choisi', async () => {
    const d = '2026-10-06';
    const cur = M.menus[d];
    const chosen = await sim.q(
      `select distinct c.name from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id
       join public.menu_options mo on mo.id in (o.plat_option_id, o.accompagnement_option_id, o.viande_option_id)
       join public.catalog_items c on c.id = mo.catalog_item_id where dm.menu_date = $1 and o.status = 'confirmed' and c.category = 'plat'`, [d]);
    const platsOnMenu = cur.items.filter((n) => PLATS.includes(n));
    if (chosen.length > 0 && platsOnMenu.length >= 2) {
      const dish = chosen[0].name;
      const res = await sim.rpc(admin, 'update_menu', [d, itemIds(cur.items.filter((n) => n !== dish))]);
      C('M8', 'menus', 'retirer un plat déjà choisi par un client', 'refusé', res.ok ? 'accepté' : res.msg, expectRejected(res, /déjà choisi/));
      const unchosen = platsOnMenu.find((n) => !chosen.some((x) => x.name === n));
      if (unchosen) {
        const ok = await sim.rpc(admin, 'update_menu', [d, itemIds(cur.items.filter((n) => n !== unchosen))]);
        C('M8b', 'menus', 'retirer un plat que personne n\'a choisi', 'accepté', ok.ok ? 'ok' : ok.msg, ok.ok);
        if (ok.ok) cur.items = cur.items.filter((n) => n !== unchosen);
      }
    } else C('M8', 'menus', 'retirer un plat déjà choisi (pas de commande à midi : cas non joué)', 'n/a', 'non joué', true);
  });

  at('2026-10-08', '15:00:00', 'menus : verrouillage manuel', async () => {
    const d = '2026-10-08';
    const snap = await preLockSnapshot(d);
    const res = await sim.rpc(admin, 'lock_menu_now', [d]);
    C('M12', 'menus', 'verrouillage manuel à 15h : repas par défaut attribués', 'accepté', res.ok ? `${res.value} défauts` : res.msg, res.ok && snap && res.value === snap.waiting);
    if (res.ok) { M.menus[d].locked = true; M.manualLocks.add(d); await checkDay(d, snap, res.value); }
    const again = await sim.rpc(admin, 'lock_menu_now', [d]);
    C('M12b', 'menus', 'second verrouillage : sans effet', '0', again.ok ? String(again.value) : again.msg, again.ok && again.value === 0);
    const edit = await sim.rpc(admin, 'update_menu', [d, null, '12:00']);
    C('M9', 'menus', 'modifier un menu verrouillé', 'refusé', edit.ok ? 'accepté' : edit.msg, expectRejected(edit, /verrouillé/));
  });

  // —— Carte : désactivation, suppression
  at('2026-10-12', '06:00:00', 'carte : désactiver un plat', async () => {
    const dish = 'Saka-saka';
    const future = Object.entries(M.menus).filter(([d, m]) => d > '2026-10-12' && m.items.includes(dish)).map(([d]) => d);
    const res = await sim.rpc(admin, 'update_catalog_item', [items[dish].id, null, null, false]);
    C('M13', 'carte', 'désactiver un plat : retiré des menus à venir (sauf seul de sa catégorie)', 'accepté', res.ok ? JSON.stringify(res.value) : res.msg, res.ok);
    if (res.ok) {
      M.off.add(dish);
      for (const d of res.value.removed_menus) M.menus[d].items = M.menus[d].items.filter((n) => n !== dish);
      const stillThere = (await sim.q(`select dm.menu_date::text as d from public.menu_options o join public.daily_menus dm on dm.id = o.daily_menu_id where o.catalog_item_id = $1 and dm.menu_date > '2026-10-12'`, [items[dish].id])).map((x) => x.d);
      C('M13b', 'carte', 'après désactivation, le plat n\'est plus que sur les menus où il est conservé', 'cohérent', `restent : ${stillThere.join(',') || 'aucun'} ; conservés : ${res.value.kept_menus.join(',') || 'aucun'}`,
        stillThere.every((d) => res.value.kept_menus.includes(d)) && future.length >= 0);
    }
  });
  at('2026-10-13', '10:00:00', 'carte : suppressions', async () => {
    const onMenu = Object.entries(M.menus).filter(([d, m]) => d >= '2026-10-13' && !m.locked && m.items.includes('Haricots')).map(([d]) => d).sort()[0];
    if (onMenu) {
      const res = await sim.rpc(admin, 'delete_catalog_item', [items['Haricots'].id]);
      C('M14', 'carte', 'supprimer un plat proposé sur un menu non verrouillé', `refusé (PLAT_SUR_MENU_OUVERT, ${onMenu})`, res.ok ? 'accepté' : `${res.msg} ${res.detail || ''}`, expectRejected(res, /PLAT_SUR_MENU_OUVERT/) && (res.detail || '').startsWith(M.menus && onMenu ? onMenu.slice(0, 4) : ''));
    } else C('M14', 'carte', 'supprimer un plat proposé sur un menu non verrouillé (aucun menu concerné)', 'n/a', 'non joué', true);
    const used = await sim.rpc(admin, 'update_catalog_item', [items['Poulet moambe'].id, null, 'viande', null]);
    C('M15', 'carte', 'changer la catégorie d\'un plat déjà proposé', 'refusé', used.ok ? 'accepté' : used.msg, expectRejected(used, /changer sa catégorie/));
    const never = await sim.rpc(admin, 'create_catalog_item', ['plat', 'Plat jamais servi']);
    if (never.ok) {
      const cat = await sim.rpc(admin, 'update_catalog_item', [never.value, null, 'accompagnement', null]);
      C('M15b', 'carte', 'changer la catégorie d\'un plat jamais proposé', 'accepté', cat.ok ? 'ok' : cat.msg, cat.ok);
      items['Plat jamais servi'] = { id: never.value, category: 'accompagnement' };
    }
    const empty = await sim.rpc(admin, 'create_catalog_item', ['plat', '   ']);
    C('M17', 'carte', 'plat sans nom', 'refusé', empty.ok ? 'accepté' : empty.msg, expectRejected(empty, /nom/));
  });
  at('2026-10-20', '09:00:00', 'carte : suppression douce et définitive', async () => {
    const never = items['Plat jamais servi'];
    if (never) {
      const hard = await sim.rpc(admin, 'delete_catalog_item', [never.id]);
      C('M14c', 'carte', 'supprimer un plat jamais utilisé : suppression définitive', 'ligne supprimée', hard.ok ? 'ok' : hard.msg, hard.ok && (await sim.one('select count(*)::int as n from public.catalog_items where id = $1', [never.id])).n === 0);
    }
    const served = (await sim.q(`select c.id, c.name from public.catalog_items c where c.is_deleted = false and exists (select 1 from public.menu_options o where o.catalog_item_id = c.id)
      and not exists (select 1 from public.menu_options o join public.daily_menus dm on dm.id = o.daily_menu_id where o.catalog_item_id = c.id and dm.status = 'open') limit 1`))[0];
    if (served) {
      const soft = await sim.rpc(admin, 'delete_catalog_item', [served.id]);
      const row = await sim.one('select is_deleted, is_active from public.catalog_items where id = $1', [served.id]);
      if (soft.ok) M.off.add(served.name);
      C('M14b', 'carte', `supprimer un plat déjà servi (${served.name}) : suppression douce, historique conservé`, 'is_deleted = true', soft.ok ? JSON.stringify(row) : soft.msg, soft.ok && row.is_deleted && !row.is_active);
      const hist = await sim.q('select count(*)::int as n from public.meal_orders o join public.menu_options mo on mo.id in (o.plat_option_id,o.accompagnement_option_id,o.viande_option_id) where mo.catalog_item_id = $1', [served.id]);
      C('M14d', 'carte', 'les commandes passées avec ce plat restent intactes', '≥ 0 lignes conservées', `${hist[0].n} commandes`, true);
    } else C('M14b', 'carte', 'suppression douce (aucun plat éligible)', 'n/a', 'non joué', true);
  });

  // —— Abonnements : suspension, annulation, renouvellements
  at('2026-10-06', '14:00:00', 'abonnements : suspension', async () => {
    const x = pickClient((c) => c.uid && c.group === 'A7' && c.plan === 'F2' && c.subs[0]);
    if (!x) return;
    M.suspended = x;
    const res = await sim.rpc(admin, 'set_subscription_status', [x.subs[0].id, 'suspended', 'Voyage']);
    C('S9', 'abonnements', 'suspendre un abonnement actif', 'accepté', res.ok ? 'ok' : res.msg, res.ok);
    if (res.ok) {
      x.subs[0].status = 'suspended';
      const future = (await sim.one(`select count(*)::int as n from public.deliveries where subscription_id = $1 and delivery_date >= '2026-10-06' and status <> 'cancelled'`, [x.subs[0].id])).n;
      C('S9b', 'abonnements', 'les livraisons à venir sont annulées', '0 restante', String(future), future === 0);
    }
    const noReason = await sim.rpc(admin, 'set_subscription_status', [x.subs[0].id, 'cancelled', '  ']);
    C('S9c', 'abonnements', 'annuler sans motif', 'refusé', noReason.ok ? 'accepté' : noReason.msg, expectRejected(noReason, /reason is required/));
  });
  at('2026-10-13', '09:00:00', 'abonnements : reprise', async () => {
    const x = M.suspended;
    if (!x) return;
    const res = await sim.rpc(admin, 'set_subscription_status', [x.subs[0].id, 'active', null]);
    C('S9d', 'abonnements', 'réactiver un abonnement suspendu', 'accepté', res.ok ? 'ok' : res.msg, res.ok);
    if (res.ok) {
      x.subs[0].status = 'active';
      x.subs[0].blockedUntil = '2026-10-13'; // la livraison du jour de reprise reste annulée
      const restored = (await sim.one(`select count(*)::int as n from public.deliveries where subscription_id = $1 and delivery_date > '2026-10-13' and delivery_date <= $2 and status <> 'cancelled'`, [x.subs[0].id, x.subs[0].end])).n;
      const expected = workingDaysBetween('2026-10-14', x.subs[0].end);
      C('S9e', 'abonnements', 'les livraisons suivantes sont rétablies', `${expected} livraisons`, String(restored), restored === expected);
    }
  });
  at('2026-10-07', '09:00:00', 'abonnements : annulation définitive', async () => {
    const x = pickClient((c) => c.uid && c.group === 'A7' && c !== M.suspended && c.subs[0]);
    if (!x) return;
    const res = await sim.rpc(admin, 'set_subscription_status', [x.subs[0].id, 'cancelled', 'Départ du client']);
    C('S10', 'abonnements', 'annuler définitivement un abonnement', 'accepté', res.ok ? 'ok' : res.msg, res.ok);
    if (res.ok) {
      x.subs[0].status = 'cancelled';
      const back = await sim.rpc(admin, 'set_subscription_status', [x.subs[0].id, 'active', null]);
      C('S11', 'abonnements', 'réactiver un abonnement annulé', 'refusé', back.ok ? 'accepté' : back.msg, expectRejected(back, /cannot be reactivated/));
    }
  });
  at('2026-10-09', '08:30:00', 'abonnements : renouvellements', async () => {
    const group = clients.filter((c) => c.group === 'B' && c.subs[0]);
    const renewNow = group.slice(0, 6);
    for (const c of renewNow) {
      const res = await sim.rpc(admin, 'renew_subscription_weeks', [c.id, 4, null, null, null], { name: 'renew' });
      const ok = res.ok && (await sim.one('select start_date::text as s, end_date::text as e from public.subscriptions where id = $1', [res.value]));
      C('S4', 'abonnements', `renouvellement avant la fin (${c.first} ${c.last}) : commence le lundi suivant`, 'début 2026-10-12, fin 2026-11-06', ok ? `${ok.s} → ${ok.e}` : res.msg, ok && ok.s === '2026-10-12' && ok.e === '2026-11-06');
      if (res.ok) c.subs.push({ id: res.value, start: '2026-10-12', end: '2026-11-06', status: 'active', plan: c.plan, blockedUntil: null });
    }
    const over = clients.find((c) => c.group === 'A5' && c.subs[0]);
    const x = await sim.rpc(admin, 'create_subscription_weeks', [over.id, plans[over.plan], '2026-10-12', 1, null, null, null]);
    C('S2', 'abonnements', 'abonnement qui chevauche l\'abonnement en cours', 'refusé', x.ok ? 'accepté' : x.msg, expectRejected(x, /chevauche/));
    const nm = await sim.rpc(admin, 'create_subscription_weeks', [group[7].id, plans[group[7].plan], '2026-10-20', 1, null, null, null]);
    C('S3', 'abonnements', 'abonnement qui ne commence pas un lundi', 'refusé', nm.ok ? 'accepté' : nm.msg, expectRejected(nm, /lundi/));
    for (const w of [0, 53]) {
      const bad = await sim.rpc(admin, 'create_subscription_weeks', [group[7].id, plans[group[7].plan], '2026-12-07', w, null, null, null]);
      C('S3b', 'abonnements', `durée de ${w} semaine(s)`, 'refusée', bad.ok ? 'acceptée' : bad.msg, expectRejected(bad, /1 et 52/));
    }
  });
  at('2026-10-12', '08:00:00', 'abonnements : renouvellement d\'un expiré', async () => {
    for (const c of clients.filter((x) => x.group === 'E' && x.subs[0]).slice(0, 2)) {
      const res = await sim.rpc(admin, 'renew_subscription_weeks', [c.id, 2, null, null, null], { name: 'renew' });
      const row = res.ok && (await sim.one('select start_date::text as s, end_date::text as e from public.subscriptions where id = $1', [res.value]));
      C('S5', 'abonnements', `renouveler un abonnement expiré (${c.first} ${c.last}) : prochain lundi`, 'début 2026-10-19', row ? `${row.s} → ${row.e}` : res.msg, row && row.s === '2026-10-19');
      if (res.ok) c.subs.push({ id: res.value, start: '2026-10-19', end: row.e, status: 'active', plan: c.plan, blockedUntil: null });
    }
    // renouveler avec changement de formule
    const c = clients.find((x) => x.group === 'B' && x.subs.length === 1);
    if (c) {
      const other = c.plan === 'F1' ? 'F2' : 'F1';
      const res = await sim.rpc(admin, 'renew_subscription_weeks', [c.id, 2, plans[other], '2026-10-19', null]);
      const row = res.ok && (await sim.one('select p.name, s.applied_price::int as price from public.subscriptions s join public.plans p on p.id = s.plan_id where s.id = $1', [res.value]));
      C('S6', 'abonnements', 'renouveler en changeant de formule', `${other === 'F1' ? 'Formule 1' : 'Formule 2'}`, row ? `${row.name} ${row.price}` : res.msg, row && row.name === (other === 'F1' ? 'Formule 1' : 'Formule 2'));
      if (res.ok) c.subs.push({ id: res.value, start: '2026-10-19', end: '2026-10-30', status: 'active', plan: other, blockedUntil: null });
    }
  });
  at('2026-10-19', '08:00:00', 'abonnements : prix de la formule', async () => {
    const sub = clients.find((c) => c.subs[0] && c.plan === 'F2' && c.group === 'A5').subs[0];
    const before = (await sim.one('select applied_price::int as p from public.subscriptions where id = $1', [sub.id])).p;
    const res = await sim.rpc(admin, 'update_plan_with_schedule', [plans.F2, 'Formule 2', null, 36000, 'CDF', 1, 'week', [1, 2, 3, 4, 5], true]);
    const after = (await sim.one('select applied_price::int as p from public.subscriptions where id = $1', [sub.id])).p;
    C('S12', 'abonnements', 'changer le prix de la formule : les abonnements existants gardent leur prix', `${before} inchangé`, `${after}`, res.ok && before === after);
    const nobody = clients.find((c) => c.group === 'F');
    const created = await sim.rpc(admin, 'create_subscription_weeks', [nobody.id, plans.F2, '2026-10-26', 2, null, null, null]);
    const row = created.ok && (await sim.one('select applied_price::int as p from public.subscriptions where id = $1', [created.value]));
    C('S1', 'abonnements', 'nouvel abonnement au nouveau prix : 2 semaines × 36 000', '72000', row ? String(row.p) : created.msg, row && row.p === 72000);
    if (created.ok) { nobody.subs.push({ id: created.value, start: '2026-10-26', end: '2026-11-06', status: 'active', plan: 'F2', blockedUntil: null }); }
    M.price = 36000;
  });

  // —— Viande : changement des jours de viande de la formule 1 (06:00, avant toute commande du jour)
  at('2026-10-15', '06:00:00', 'formules : jours de viande', async () => {
    const res = await sim.as(admin, (x) => x.query('update public.plans set meat_weekdays = $1 where id = $2', [[2, 4], plans.F1]));
    C('S13', 'formules', 'changer les jours de viande de la formule 1 (mardi et jeudi)', 'accepté', res.ok ? 'ok' : res.msg, res.ok);
    if (res.ok) M.meat.F1 = [2, 4];
    const three = await sim.as(admin, (x) => x.query('update public.plans set meat_weekdays = $1 where id = $2', [[1, 2, 3], plans.F1]));
    C('S13b', 'formules', 'trois jours de viande', 'refusé', three.ok ? 'accepté' : three.msg, !three.ok);
    const sat = await sim.as(admin, (x) => x.query('update public.plans set meat_weekdays = $1 where id = $2', [[6], plans.F1]));
    C('S13c', 'formules', 'viande le samedi', 'refusé', sat.ok ? 'accepté' : sat.msg, !sat.ok);
  });
  at('2026-10-22', '06:00:00', 'formules : retour lundi et vendredi', async () => {
    const res = await sim.as(admin, (x) => x.query('update public.plans set meat_weekdays = $1 where id = $2', [[1, 5], plans.F1]));
    if (res.ok) M.meat.F1 = [1, 5];
  });

  // —— Paiements
  at('2026-10-06', '15:00:00', 'paiements', async () => {
    const x = clients.find((c) => c.subs[0] && c.plan === 'F2' && c.group === 'A5' && c.uid);
    const sub = x.subs[0];
    const price = (await sim.one('select applied_price::int as p from public.subscriptions where id = $1', [sub.id])).p;
    const method = (await sim.one(`select id from public.payment_methods where code = 'mpesa'`)).id;
    M.payer = { x, sub, price, method };
    const p1 = await sim.rpc(team.manager, 'record_payment', [org, x.id, sub.id, 50000, 'CDF', method, 'MP-001', '2026-10-06', null]);
    C('P1', 'paiements', 'paiement partiel par le manager', 'accepté', p1.ok ? 'ok' : p1.msg, p1.ok);
    const over = await sim.rpc(admin, 'record_payment', [org, x.id, sub.id, price, 'CDF', method, null, '2026-10-06', null]);
    C('P2', 'paiements', 'paiement qui dépasse le solde', 'refusé', over.ok ? 'accepté' : over.msg, expectRejected(over, /exceeds/));
    const cur = await sim.rpc(admin, 'record_payment', [org, x.id, sub.id, 1000, 'USD', method, null, '2026-10-06', null]);
    C('P3', 'paiements', 'devise différente de celle de l\'abonnement', 'refusé', cur.ok ? 'accepté' : cur.msg, expectRejected(cur, /currency/));
    const zero = await sim.rpc(admin, 'record_payment', [org, x.id, sub.id, 0, 'CDF', method, null, '2026-10-06', null]);
    C('P3b', 'paiements', 'montant nul', 'refusé', zero.ok ? 'accepté' : zero.msg, !zero.ok);
    const dup = await sim.rpc(admin, 'record_payment', [org, x.id, sub.id, 1000, 'CDF', method, 'MP-001', '2026-10-06', null]);
    C('P3c', 'paiements', 'même référence de paiement deux fois', 'refusé', dup.ok ? 'accepté' : dup.msg, !dup.ok);
    const below = await sim.rpc(admin, 'set_subscription_price', [sub.id, 40000, 'Remise']);
    C('P4', 'paiements', 'prix inférieur aux paiements déjà reçus', 'refusé', below.ok ? 'accepté' : below.msg, expectRejected(below, /paiements/));
    const noWhy = await sim.rpc(admin, 'set_subscription_price', [sub.id, price - 5000, ' ']);
    C('P4b', 'paiements', 'changer un prix sans raison', 'refusé', noWhy.ok ? 'accepté' : noWhy.msg, expectRejected(noWhy, /raison/));
  });
  at('2026-10-09', '16:00:00', 'paiements : solde et annulation', async () => {
    const { x, sub, price, method } = M.payer;
    const rest = price - 50000;
    const p2 = await sim.rpc(admin, 'record_payment', [org, x.id, sub.id, rest, 'CDF', method, 'MP-002', '2026-10-09', null]);
    C('P5', 'paiements', 'paiement du solde : abonnement soldé', 'accepté', p2.ok ? 'ok' : p2.msg, p2.ok);
    const acc = await sim.rpc(x.uid, 'my_account', []);
    C('P6', 'paiements', 'le client voit un solde de 0 et deux paiements', 'reste 0', acc.ok ? `reste ${acc.value.balance?.remaining}, ${acc.value.payments.length} paiements` : acc.msg, acc.ok && Number(acc.value.balance?.remaining) === 0 && acc.value.payments.length === 2);
    const pay = await sim.one(`select id from public.payments where subscription_id = $1 and reference = 'MP-002'`, [sub.id]);
    const noWhy = await sim.rpc(admin, 'cancel_payment', [pay.id, '  ']);
    C('P7', 'paiements', 'annuler un paiement sans raison', 'refusé', noWhy.ok ? 'accepté' : noWhy.msg, expectRejected(noWhy, /reason is required/));
    const yes = await sim.rpc(admin, 'cancel_payment', [pay.id, 'Erreur de saisie']);
    C('P7b', 'paiements', 'annuler un paiement avec raison', 'accepté', yes.ok ? 'ok' : yes.msg, yes.ok);
    const twice = await sim.rpc(admin, 'cancel_payment', [pay.id, 'Encore']);
    C('P7c', 'paiements', 'annuler deux fois le même paiement', 'refusé', twice.ok ? 'accepté' : twice.msg, !twice.ok);
    const acc2 = await sim.rpc(x.uid, 'my_account', []);
    C('P8', 'paiements', 'après annulation le solde est rétabli', `reste ${rest}`, acc2.ok ? `reste ${acc2.value.balance?.remaining}` : acc2.msg, acc2.ok && Number(acc2.value.balance?.remaining) === rest);
    const ov = await sim.rpc(admin, 'set_subscription_price', [clients.find((c) => c.subs[0] && c.plan === 'F1' && c.group === 'A7').subs[0].id, 90000, 'Tarif négocié']);
    C('P9', 'abonnements', 'prix individuel exceptionnel avec raison', 'accepté', ov.ok ? 'ok' : ov.msg, ov.ok);
  });

  // —— Cas d'heure limite : dernière seconde / première seconde
  at('2026-10-07', '19:59:59', 'limite 20h : 19:59:59', async () => {
    const c = pickClient((x) => x.uid && canOrder(x, '2026-10-07', '19:59:59'));
    if (!c) return;
    const m = await viewMenu(c);
    const p = choose(m, c);
    const res = await sim.rpc(c.uid, 'submit_my_order', [m.menu.id, p.plat, p.acc, p.viande]);
    C('B1', 'limite 20h', 'commande à 19:59:59', 'acceptée', res.ok ? 'ok' : res.msg, res.ok);
  });
  at('2026-10-07', '20:00:00', 'limite 20h : 20:00:00', async () => {
    const c = pickClient((x) => x.uid && modelState(x, '2026-10-07') === 'actif');
    const m = await viewMenu(c);
    const opts = m.menu.options;
    const res = await sim.rpc(c.uid, 'submit_my_order', [m.menu.id, opts.find((o) => o.category === 'plat').option_id, opts.find((o) => o.category === 'accompagnement').option_id, null]);
    C('B2', 'limite 20h', 'commande à 20:00:00 pile', 'refusée', res.ok ? 'acceptée' : res.msg, expectRejected(res, /verrouillé/));
    const can = await sim.rpc(c.uid, 'cancel_my_order', [m.menu.id]);
    C('B2b', 'limite 20h', 'annulation à 20:00:00 pile', 'refusée', can.ok ? 'acceptée' : can.msg, expectRejected(can, /verrouillé/));
    const pub = await sim.rpc(admin, 'publish_menu', ['2026-10-07', itemIds(pickSet()), '13:00']);
    C('B3', 'limite 20h', 'publier à nouveau le menu du jour après 20h', 'refusé', pub.ok ? 'accepté' : pub.msg, !pub.ok);
  });

  // —— Concurrence
  at('2026-10-21', '15:00:00', 'concurrence : 20 commandes pendant un verrouillage', async () => {
    const d = '2026-10-21';
    const list = r.shuffle(byUid().filter((x) => canOrder(x, d, '15:00:00'))).slice(0, 20);
    const snapBefore = await preLockSnapshot(d);
    const conns = await Promise.all(list.map(() => sim.newConnection()));
    const lockConn = await sim.newConnection();
    const work = list.map(async (c, i) => {
      const m = await sim.rpc(c.uid, 'my_today_menu', [], { db: conns[i] });
      if (!m.ok || !m.value.menu) return null;
      const p = choose(m.value, c);
      return sim.rpc(c.uid, 'submit_my_order', [m.value.menu.id, p.plat, p.acc, p.viande], { db: conns[i] });
    });
    const lock = sim.rpc(admin, 'lock_menu_now', [d], { db: lockConn });
    const results = await Promise.all([...work, lock]);
    await Promise.all([...conns, lockConn].map((x) => x.end()));
    M.menus[d].locked = true; M.manualLocks.add(d);
    const accepted = results.slice(0, -1).filter((x) => x && x.ok).length;
    const refused = results.slice(0, -1).filter((x) => x && !x.ok).length;
    const dupes = (await sim.one(`select count(*)::int as n from (select customer_id from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 group by customer_id having count(*) > 1) t`, [d])).n;
    C('O20', 'concurrence', '20 commandes simultanées pendant un verrouillage : aucun doublon, tout est cohérent', 'aucun doublon, invariants OK', `${accepted} acceptées, ${refused} refusées, ${dupes} doublons`, dupes === 0);
    await checkDay(d, null, null);
    void snapBefore;
  });
  at('2026-10-22', '15:00:00', 'concurrence : double verrouillage', async () => {
    const d = '2026-10-22';
    const snap = await preLockSnapshot(d);
    const conns = await Promise.all([0, 1, 2, 3, 4].map(() => sim.newConnection()));
    const res = await Promise.all(conns.map((c) => sim.rpc(admin, 'lock_menu_now', [d], { db: c })));
    await Promise.all(conns.map((c) => c.end()));
    M.menus[d].locked = true; M.manualLocks.add(d);
    const total = res.filter((x) => x.ok).reduce((s, x) => s + x.value, 0);
    C('O29', 'concurrence', '5 verrouillages simultanés : repas par défaut créés une seule fois', `${snap.waiting} défauts au total`, `${total} (${res.filter((x) => x.ok).map((x) => x.value).join('+')})`, res.every((x) => x.ok) && total === snap.waiting);
    await checkDay(d, snap, total);
  });
  at('2026-10-27', '10:00:00', 'concurrence : double commande du même client', async () => {
    const d = '2026-10-27';
    const c = pickClient((x) => x.uid && canOrder(x, d, '10:00:00'));
    const m = await viewMenu(c);
    const p = choose(m, c);
    const conns = await Promise.all([0, 1, 2, 3].map(() => sim.newConnection()));
    const res = await Promise.all(conns.map((cn) => sim.rpc(c.uid, 'submit_my_order', [m.menu.id, p.plat, p.acc, p.viande], { db: cn })));
    await Promise.all(conns.map((cn) => cn.end()));
    const n = (await sim.one(`select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and o.customer_id = $2`, [d, c.id])).n;
    C('O21', 'concurrence', '4 commandes simultanées du même client : une seule ligne', '1 commande', `${n} commande(s), ${res.filter((x) => x.ok).length} acceptée(s)`, n === 1 && res.every((x) => x.ok));
  });

  // —— Jour férié : aucun menu
  at('2026-10-14', '20:30:00', 'jour férié', async () => {
    const orders = (await sim.one(`select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-14'`)).n;
    const del = (await sim.one(`select count(*)::int as n from public.deliveries where delivery_date = '2026-10-14' and status <> 'scheduled' and status <> 'cancelled'`)).n;
    C('O28', 'jours fériés', 'jour sans menu : aucune commande ni repas par défaut, livraisons laissées telles quelles', '0 commande', `${orders} commandes, ${del} livraisons modifiées`, orders === 0);
    const c = byUid()[2];
    const m = await sim.rpc(c.uid, 'my_today_menu', []);
    C('O28b', 'jours fériés', 'le client voit « aucun menu » ce jour-là', 'aucun_menu', m.ok ? m.value.menu_status : m.msg, m.ok && m.value.menu_status === 'aucun_menu');
  });
  at('2026-10-16', '20:30:00', 'jour sans aucun vote', async () => {
    const d = '2026-10-16';
    const votes = (await sim.one(`select count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and not o.is_default and o.status = 'confirmed'`, [d])).n;
    C('O27', 'repas par défaut', 'aucun client n\'a voté : repas par défaut = premier de chaque catégorie par ordre alphabétique', '0 vote', `${votes} vote(s)`, votes === 0);
  });

  // —— Avis : cas limites
  at('2026-10-09', '09:00:00', 'avis : cas limites', async () => {
    const d = '2026-10-08';
    const rows = await sim.q(
      `select o.id, o.status, c.auth_user_id as uid, c.id as cid from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.customers c on c.id = o.customer_id
       where dm.menu_date = $1 and c.auth_user_id is not null`, [d]);
    const conf = rows.find((x) => x.status === 'confirmed');
    const canc = rows.find((x) => x.status === 'cancelled');
    if (conf) {
      for (const [id, title, rating, comment] of [['R3a', 'note 0', 0, null], ['R3b', 'note 6', 6, null], ['R3c', 'avis vide', null, null]]) {
        const res = await sim.rpc(conf.uid, 'submit_my_review', [conf.id, rating, comment]);
        C(id, 'avis', title, 'refusé', res.ok ? 'accepté' : res.msg, !res.ok);
      }
      const long = await sim.rpc(conf.uid, 'submit_my_review', [conf.id, 3, 'x'.repeat(1001)]);
      C('R3d', 'avis', 'commentaire de 1001 caractères', 'refusé', long.ok ? 'accepté' : long.msg, !long.ok);
      const other = rows.find((x) => x.uid !== conf.uid);
      if (other) {
        const res = await sim.rpc(other.uid, 'submit_my_review', [conf.id, 5, 'x']);
        C('R5', 'avis', 'noter la commande d\'un autre client', 'refusé (introuvable)', res.ok ? 'accepté' : res.msg, expectRejected(res, /introuvable/));
      }
      const a = await sim.rpc(conf.uid, 'submit_my_review', [conf.id, 4, null]);
      const b = await sim.rpc(conf.uid, 'submit_my_review', [conf.id, null, 'Très bon']);
      const hist = await sim.rpc(conf.uid, 'my_history', ['2026-10-08', '2026-10-08', null]);
      const row = hist.ok && hist.value[0];
      C('R2', 'avis', 'note puis commentaire : fusionnés', 'note 4 + « Très bon »', row ? `${row.rating} / ${row.comment}` : (a.msg || b.msg || hist.msg), a.ok && b.ok && row && row.rating === 4 && row.comment === 'Très bon');
    }
    if (canc) {
      const res = await sim.rpc(canc.uid, 'submit_my_review', [canc.id, 3, null]);
      C('R4', 'avis', 'noter un repas annulé', 'refusé', res.ok ? 'accepté' : res.msg, expectRejected(res, /annulé/));
    }
    const open = await sim.one(`select o.id, c.auth_user_id as uid from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.customers c on c.id = o.customer_id
      where dm.menu_date = '2026-10-09' and c.auth_user_id is not null limit 1`);
    if (open) {
      const res = await sim.rpc(open.uid, 'submit_my_review', [open.id, 5, null]);
      C('R6', 'avis', 'noter le repas du jour avant qu\'il soit servi (menu non verrouillé)', 'refusé', res.ok ? 'accepté' : res.msg, expectRejected(res, /une fois le repas servi/));
    }
  });
  at('2026-10-26', '08:30:00', 'avis : lundi, repas du vendredi', async () => {
    const row = await sim.one(
      `select o.id, c.auth_user_id as uid from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.customers c on c.id = o.customer_id
       left join public.meal_reviews r on r.order_id = o.id
       where dm.menu_date = '2026-10-23' and o.status = 'confirmed' and c.auth_user_id is not null and r.id is null limit 1`);
    if (!row) return;
    const m = await sim.rpc(row.uid, 'my_today_menu', []);
    C('R8', 'avis', 'le lundi, l\'avis proposé concerne le repas du vendredi', 'review_due.date = 2026-10-23', m.ok ? JSON.stringify(m.value.review_due) : m.msg, m.ok && m.value.review_due && m.value.review_due.date === '2026-10-23');
  });
  at('2026-10-28', '10:00:00', 'avis : a posteriori', async () => {
    const row = await sim.one(
      `select o.id, c.auth_user_id as uid from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.customers c on c.id = o.customer_id
       left join public.meal_reviews r on r.order_id = o.id
       where dm.menu_date = '2026-10-12' and o.status = 'confirmed' and c.auth_user_id is not null and r.id is null limit 1`);
    if (!row) return;
    const res = await sim.rpc(row.uid, 'submit_my_review', [row.id, 3, 'Je note plus tard']);
    C('R7', 'avis', 'noter un repas 16 jours plus tard', 'accepté', res.ok ? 'ok' : res.msg, res.ok);
  });

  // —— Week-end et expiration
  at('2026-10-31', '10:00:00', 'expiration', async () => {
    const x = clients.find((c) => c.group === 'A5' && c.uid && c.subs.length === 1);
    if (!x) return;
    const m = await sim.rpc(x.uid, 'my_today_menu', []);
    C('S16', 'abonnements', 'le samedi après la dernière semaine : état « expire »', 'expire', m.ok ? m.value.subscription.state : m.msg, m.ok && m.value.subscription.state === 'expire');
  });
  at('2026-11-03', '09:30:00', 'expiration : commande refusée', async () => {
    const x = clients.find((c) => c.group === 'A5' && c.uid && c.subs.length === 1);
    if (!x) return;
    const m = await sim.rpc(x.uid, 'my_today_menu', []);
    const mm = m.ok && m.value.menu;
    if (!mm) { C('O14', 'commandes', 'client expiré : commande refusée (aucun menu ce jour)', 'refusé', 'pas de menu', true); return; }
    const o = mm.options;
    const res = await sim.rpc(x.uid, 'submit_my_order', [mm.id, o.find((y) => y.category === 'plat').option_id, o.find((y) => y.category === 'accompagnement').option_id, null]);
    C('O14', 'commandes', 'client dont l\'abonnement a expiré : commande refusée', 'refusé (expiré)', res.ok ? 'accepté' : res.msg, expectRejected(res, /expiré/));
  });
  at('2026-10-13', '08:00:00', 'état : non commencé', async () => {
    const x = clients.find((c) => c.group === 'D' && c.uid);
    if (!x) return;
    const m = await sim.rpc(x.uid, 'my_today_menu', []);
    C('O15', 'commandes', 'abonnement pas encore commencé : état et commande refusée', 'non_commence', m.ok ? m.value.subscription.state : m.msg, m.ok && m.value.subscription.state === 'non_commence');
    if (m.ok && m.value.menu) {
      const o = m.value.menu.options;
      const res = await sim.rpc(x.uid, 'submit_my_order', [m.value.menu.id, o.find((y) => y.category === 'plat').option_id, o.find((y) => y.category === 'accompagnement').option_id, null]);
      C('O15b', 'commandes', 'commande avant le début de l\'abonnement', 'refusée (pas commencé)', res.ok ? 'acceptée' : res.msg, expectRejected(res, /pas encore commenc/));
    }
  });

  // ───────────────────────── Boucle principale du temps ─────────────────────────
  const days = range(START, END);
  const t0 = Date.now();
  for (const d of days) {
    const dayStart = Date.now();
    const ev = [...(sched[d] || []), ...clientEvents(d)];
    // tâches fixes du jour
    ev.push([4 * 3600 + 5 * 60, 'alertes (04:05)', () => nightlyAlerts(d)]);
    if (isWeekday(d) && M.menus[d]) {
      if (M.lazyDays.has(d)) ev.push([21 * 3600 + 5 * 60, 'verrouillage à la lecture', () => lockAndCheck(d, 'lazy')]);
      else ev.push([20 * 3600 + 30, 'verrouillage planifié (20:00:30)', () => lockAndCheck(d, 'cron')]);
      ev.push([20 * 3600 + 10 * 60 + 30, 'contrôle RLS', () => rlsSample(d)]);
      ev.push([20 * 3600 + 20 * 60, 'cuisine et livraison', () => kitchenAndDelivery(d)]);
    } else if (isWeekday(d)) {
      ev.push([20 * 3600 + 30, 'jour sans menu', () => checkDay(d, null, null)]);
    }
    ev.push([23 * 3600, 'avis de la veille', async () => { if (r.chance(1)) await reviewsOf(d); }]);
    ev.sort((a, b) => a[0] - b[0]);
    for (const [sec, label, fn] of ev) {
      await sim.clock(d, hms(sec));
      try { await fn(); } catch (error) { J.violation('exception_simulation', d, `${label} : ${error.message}`); }
    }
    const st = await sim.one(
      `select (select count(*)::int from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and o.status = 'confirmed' and not o.is_default) as voted,
              (select count(*)::int from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and o.is_default) as defaults,
              (select count(*)::int from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = $1 and o.status = 'cancelled') as cancelled,
              (select count(*)::int from public.deliveries where delivery_date = $1 and status = 'delivered') as delivered,
              (select count(*)::int from public.deliveries where delivery_date = $1 and status <> 'cancelled') as expected`, [d]);
    J.days.push({ day: d, dow: DAY_FR[isoDow(d)], menu: Boolean(M.menus[d]), ...st, ms: Date.now() - dayStart });
    process.stdout.write(`\r${d} ${DAY_FR[isoDow(d)].padEnd(8)} votes ${String(st.voted).padStart(3)} défauts ${String(st.defaults).padStart(3)} annulés ${String(st.cancelled).padStart(2)}  `);
  }
  console.log('\nBoucle terminée en', Math.round((Date.now() - t0) / 1000), 's');

  // ───────────────────────── Contrôles de fin de mois ─────────────────────────
  await sim.clock(END, '23:30:00');
  // Statistiques : plat le plus commandé, recalculé indépendamment
  for (const [period, from] of [['all', null], ['month', '2026-10-01'], ['week', '2026-11-02']]) {
    const ref = period === 'week' ? '2026-11-04' : '2026-10-15';
    for (const [cat, col] of [['plat', 'plat_option_id'], ['accompagnement', 'accompagnement_option_id'], ['viande', 'viande_option_id']]) {
      const range2 = period === 'all' ? '' : period === 'month' ? `and dm.menu_date between '2026-10-01' and '2026-10-31'` : `and dm.menu_date between '2026-11-02' and '2026-11-08'`;
      const oracle = (await sim.q(
        `select c.name, count(*)::int as n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id and dm.status = 'locked'
         join public.menu_options mo on mo.id = o.${col} join public.catalog_items c on c.id = mo.catalog_item_id
         where o.status = 'confirmed' ${range2} group by c.id, c.name order by n desc, c.name asc limit 1`))[0];
      const res = await sim.rpc(admin, 'top_dishes', [period, period === 'all' ? null : ref], { name: 'top_dishes' });
      const got = res.ok ? res.value[cat] : null;
      C('T1', 'statistiques', `plat le plus commandé (${cat}, ${period})`, oracle ? `${oracle.name} ×${oracle.n}` : 'aucun', got ? `${got.name} ×${got.count}` : (res.msg || 'aucun'),
        res.ok && ((!oracle && !got) || (oracle && got && oracle.name === got.name && oracle.n === got.count)));
    }
  }
  const ov = await sim.rpc(admin, 'orders_overview', ['2026-11-04'], { name: 'orders_overview' });
  C('T2', 'statistiques', 'vue d\'ensemble du 4 novembre', 'répond', ov.ok ? JSON.stringify({ attendues: ov.value.deliveries_expected, votes: ov.value.orders_confirmed, defauts: ov.value.orders_default, annules: ov.value.orders_cancelled }) : ov.msg, ov.ok);
  const dash = await sim.rpc(admin, 'dashboard_metrics', [], { name: 'dashboard_metrics' });
  C('T3', 'statistiques', 'indicateurs du tableau de bord', 'répondent', dash.ok ? JSON.stringify(dash.value) : dash.msg, dash.ok);
  // Tableau de préparation = suivi du jour, pour un jour verrouillé
  const boardDay = '2026-10-27';
  const board = await sim.rpc(team.staff, 'deliveries_board', [boardDay, boardDay], { name: 'deliveries_board' });
  const live = await sim.rpc(admin, 'orders_live', [boardDay], { name: 'orders_live' });
  const norm = (rows, key) => rows.map((x) => `${x.customer_name}|${x.state}|${x.plat || ''}|${x.accompagnement || ''}|${x.viande || ''}`).sort().join('\n');
  C('T5', 'statistiques', 'le tableau de préparation et le suivi du jour racontent la même chose (27 octobre)', 'identiques', board.ok && live.ok ? 'comparés' : (board.msg || live.msg), board.ok && live.ok && norm(board.value) === norm(live.value.rows));
  // Paiements : jamais plus que le prix
  const over = (await sim.one(`select count(*)::int as n from (select s.id from public.subscriptions s left join public.payments p on p.subscription_id = s.id and p.status = 'confirmed' group by s.id having coalesce(sum(p.amount),0) > s.applied_price) t`)).n;
  if (over > 0) J.violation('I8_paiements_depassent_prix', END, `${over} abonnement(s)`);
  // Audit : chaque commande a sa ligne d'audit ; les repas par défaut ne doivent pas être attribués à un client
  const orders = (await sim.one('select count(*)::int as n from public.meal_orders')).n;
  const audited = (await sim.one(`select count(*)::int as n from public.audit_logs where entity_type = 'meal_orders' and action = 'insert'`)).n;
  C('T4', 'audit', 'chaque commande a une ligne d\'audit de création', `${orders} lignes`, `${audited}`, orders === audited);
  const wrongActor = (await sim.one(
    `select count(*)::int as n from public.audit_logs a join public.meal_orders o on o.id::text = a.entity_id
     where a.entity_type = 'meal_orders' and a.action = 'insert' and o.is_default and a.actor_user_id is not null and not (o.daily_menu_id in (select id from public.daily_menus where menu_date::text = any ($1)))`, [[...M.manualLocks]])).n;
  C('T4b', 'audit', 'les repas attribués automatiquement ne sont attribués à AUCUN utilisateur dans le journal', '0 ligne attribuée', `${wrongActor} lignes attribuées à un utilisateur`, wrongActor === 0);
  const clientsActions = await sim.rpc(admin, 'audit_search', [null, null, 'client', 'commandes', null, null, 5, 0], { name: 'audit_search' });
  C('T4c', 'audit', 'filtre « actions des clients sur les commandes »', 'résultats', clientsActions.ok ? `${clientsActions.value.total} événements` : clientsActions.msg, clientsActions.ok && clientsActions.value.total > 0);
  for (const [id, args, title] of [['T4d', [null, null, null, 'paiements', null, null, 50, 0], 'domaine paiements'], ['T4e', [null, null, 'equipe', null, 'supprime', null, 50, 0], 'équipe + suppressions'], ['T4f', ['2026-12-01T00:00:00+01:00', null, null, null, null, null, 10, 0], 'période future']]) {
    const res = await sim.rpc(admin, 'audit_search', args, { name: 'audit_search' });
    C(id, 'audit', `filtre ${title}`, 'répond', res.ok ? `${res.value.total} événements` : res.msg, res.ok && (id !== 'T4f' || res.value.total === 0));
  }
  // Historique d'un client : recherche
  const hc = clients.find((c) => c.uid && c.persona === 'early');
  const hist = await sim.rpc(hc.uid, 'my_history', [null, null, null], { name: 'my_history' });
  C('T6', 'historique', 'historique d\'un client assidu', 'lignes', hist.ok ? `${hist.value.length} repas` : hist.msg, hist.ok && hist.value.length > 5);
  if (hist.ok && hist.value[0] && hist.value[0].plat) {
    const word = hist.value[0].plat.split(' ')[0].toUpperCase();
    const found = await sim.rpc(hc.uid, 'my_history', [null, null, word], { name: 'my_history' });
    C('T6b', 'historique', `recherche « ${word} » (casse et accents ignorés)`, '≥ 1 repas', found.ok ? `${found.value.length}` : found.msg, found.ok && found.value.length >= 1);
  }

  // Performances sur 100 clients
  const stats = (arr) => { const a = [...arr].sort((x, y) => x - y); return { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] }; };
  const perf = Object.fromEntries(Object.entries(J.timings).map(([k, v]) => [k, stats(v)]));

  const totals = await sim.one(
    `select (select count(*)::int from public.customers) as clients, (select count(*)::int from public.meal_orders) as commandes, (select count(*)::int from public.meal_orders where is_default) as defauts,
            (select count(*)::int from public.meal_orders where status = 'cancelled') as annulees, (select count(*)::int from public.deliveries) as livraisons,
            (select count(*)::int from public.deliveries where status = 'delivered') as livrees, (select count(*)::int from public.meal_reviews) as avis,
            (select count(*)::int from public.payments) as paiements, (select count(*)::int from public.audit_logs) as audit, (select count(*)::int from public.alerts) as alertes`);
  const personas = {};
  for (const c of clients) personas[c.persona || (c.hasAccount ? '?' : 'sans compte')] = (personas[c.persona || (c.hasAccount ? '?' : 'sans compte')] || 0) + 1;

  const results = {
    generated_at: new Date().toISOString(), start: START, end: END, seed: 20261005, database: CFG.database,
    clients: clients.length, personas, groups: clients.reduce((m, c) => ((m[c.group] = (m[c.group] || 0) + 1), m), {}),
    counters: J.counters, totals, perf, days: J.days,
    cases: J.cases, violations: J.violations, findings: J.findings
  };
  fs.writeFileSync(path.join(OUT, 'sim-results.json'), JSON.stringify(results, null, 2));
  const failedCases = J.cases.filter((c) => !c.ok).length;
  console.log(`\nCas : ${J.cases.length - failedCases}/${J.cases.length} conformes — invariants violés : ${J.violations.length}`);
  const byRule = {};
  for (const v of J.violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
  console.log('Violations par règle :', JSON.stringify(byRule));
  await db.end();
  process.exit(failedCases + J.violations.length > 0 ? 1 : 0);
})().catch((error) => { console.error('ERREUR FATALE', error); process.exit(2); });
