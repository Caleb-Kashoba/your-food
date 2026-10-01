'use strict';
/**
 * Monde de départ de la simulation : équipe (4 rôles), formules, carte, ~100 clients de tous types et leurs abonnements.
 * Tout passe par les mêmes fonctions et règles de sécurité que l'application (rôle administratrice, activation par code…).
 */
const crypto = require('crypto');

const FIRST = ['Mireille', 'Patrick', 'Sarah', 'Freddy', 'Jean', 'Marie', 'Ruth', 'Joël', 'Grâce', 'Christelle', 'Dieudonné', 'Esther', 'Fabrice', 'Gisèle', 'Héritier', 'Inès', 'Jonathan', 'Kevin', 'Laetitia', 'Marcel', 'Nadège', 'Olivier', 'Pascaline', 'Rachel', 'Samuel', 'Trésor', 'Vanessa', 'Yannick', 'Zoé', 'Blaise', 'Clarisse', 'Déborah', 'Éric', 'Faustin', 'Gloria'];
const LAST = ['Kabongo', 'Mbuyi', 'Ilunga', 'Kalala', 'Tshimanga', 'Ngoy', 'Mukendi', 'Lumumba', 'Banza', 'Kasongo', 'Mwamba', 'Tshisekedi', 'Kabila', 'Mutombo', 'Nsimba', 'Mavungu', 'Bokungu', 'Kitenge', 'Lukusa', 'Ntumba', 'Mulumba', 'Kapinga', 'Tshibangu', 'Mpoyi', 'Kabasele'];

const PLATS = ['Pondu aux crevettes', 'Poulet moambe', 'Liboke de poisson', 'Riz au poulet', 'Saka-saka', 'Haricots à la sauce tomate', 'Spaghetti bolognaise'];
const ACCS = ['Chikwangue', 'Fufu de manioc', 'Riz blanc', 'Bananes plantain', 'Salade fraîche', 'Haricots'];
const VIANDES = ['Poisson capitaine braisé', 'Poulet grillé', 'Cuisse de poulet', 'Bœuf sauté', 'Brochettes de chèvre'];

const uuid = () => crypto.randomUUID();

async function seed(sim, r, J) {
  const org = (await sim.one('select id from public.organizations')).id;
  await sim.clock('2026-10-01', '09:00:00');

  // ── Équipe : un utilisateur par rôle
  const team = {};
  for (const [key, name, role] of [['root', 'Sarah BOKETSU', 'root'], ['admin', 'Nadine ADMIN', 'admin'], ['manager', 'Marc MANAGER', 'manager'], ['staff', 'Cuisine STAFF', 'staff']]) {
    const id = uuid();
    await sim.q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${key}@yourfood.test`, JSON.stringify({ display_name: name })]);
    await sim.q(`insert into public.organization_members (organization_id, user_id, role_id, status)
                 select $1, $2, r.id, 'active' from public.roles r where r.name = $3`, [org, id, role]);
    team[key] = id;
  }
  const admin = team.root;

  // ── Formules : prix hebdomadaires actuels ; la formule 1 : viande lundi et vendredi
  const mk = async (name, price, meat) => {
    const res = await sim.rpc(admin, 'create_plan_with_schedule', [org, name, `${name} (simulation)`, price, 'CDF', 1, 'week', [1, 2, 3, 4, 5]]);
    if (!res.ok) throw new Error('formule : ' + res.msg);
    const id = res.value;
    await sim.as(admin, (db) => db.query('update public.plans set meat_weekdays = $1 where id = $2', [meat, id]));
    return id;
  };
  const plans = { F1: await mk('Formule 1', 25000, [1, 5]), F2: await mk('Formule 2', 35000, null) };

  await sim.q(`insert into public.payment_methods (organization_id, code, name, display_order) values
    ($1,'cash','Espèces',1), ($1,'mpesa','M-Pesa',2), ($1,'airtel','Airtel Money',3), ($1,'orange','Orange Money',4)`, [org]);
  await sim.q(`insert into public.alert_rules (organization_id, alert_type, name, days_before) values
    ($1,'subscription_expiration','Expiration dans 5 jours',5), ($1,'subscription_expiration','Expiration dans 2 jours',2), ($1,'subscription_expiration','Expire aujourd''hui',0)`, [org]);

  // ── Carte
  const items = {};
  for (const [category, names] of [['plat', PLATS], ['accompagnement', ACCS], ['viande', VIANDES]]) {
    for (const name of names) {
      const res = await sim.rpc(admin, 'create_catalog_item', [category, name]);
      if (!res.ok) throw new Error('plat : ' + res.msg);
      items[name] = { id: res.value, category };
    }
  }

  // ── Clients : 100, tous profils
  const used = new Set();
  const pairs = [];
  const fullName = () => {
    for (;;) {
      const n = `${r.pick(FIRST)}|${r.pick(LAST)}`;
      if (!used.has(n)) { used.add(n); return n.split('|'); }
    }
  };
  const people = [];
  for (let i = 0; i < 100; i++) people.push({ i, name: fullName() });
  // 5 paires d'homonymes (mêmes prénom et nom, numéros différents)
  for (let p = 0; p < 5; p++) { people[90 + p * 2 + 1].name = [...people[90 + p * 2].name]; pairs.push([90 + p * 2, 90 + p * 2 + 1]); }

  // Groupes d'abonnement (voir le rapport) — l'ordre mélangé évite de lier le groupe aux homonymes
  const layout = [];
  const push = (n, g) => { for (let k = 0; k < n; k++) layout.push(g); };
  push(40, 'A5'); push(16, 'A7'); push(12, 'B'); push(8, 'C'); push(6, 'D'); push(6, 'E'); push(4, 'F'); push(8, 'G');
  const groups = r.shuffle(layout);

  const clients = [];
  for (const person of people) {
    const [first, last] = person.name;
    const noPhone = r.chance(0.07);
    const phone = noPhone ? null : `+24381${String(1000000 + person.i * 7919).slice(-7)}`;
    const res = await sim.as(admin, (db) =>
      db.query(`insert into public.customers (organization_id, first_name, last_name, phone) values ($1,$2,$3,$4) returning id`, [org, first, last, phone]).then((x) => x.rows[0].id));
    if (!res.ok) throw new Error('client : ' + res.msg);
    clients.push({ i: person.i, id: res.value, first, last, phone, group: groups[person.i], plan: r.chance(0.4) ? 'F1' : 'F2', uid: null, subs: [], persona: null });
  }

  const SUB = {
    A5: ['2026-09-28', 5], A7: ['2026-09-28', 7], B: ['2026-09-21', 3], C: ['2026-10-12', 4], D: ['2026-10-19', 2],
    E: ['2026-09-07', 2], G: ['2026-10-05', 4]
  };
  for (const c of clients) {
    if (c.group === 'F') continue; // aucun abonnement
    const [start, weeks] = SUB[c.group];
    const res = await sim.rpc(admin, 'create_subscription_weeks', [c.id, plans[c.plan], start, weeks, null, null, null]);
    if (!res.ok) throw new Error(`abonnement ${c.first} ${c.last} : ${res.msg}`);
    const end = (await sim.one('select end_date::text as e from public.subscriptions where id = $1', [res.value])).e;
    c.subs.push({ id: res.value, start, end, status: 'active', plan: c.plan, blockedUntil: null });
  }

  // ── Comptes : 80 clients ont un compte (8 par le vrai parcours code → vérification → liaison, les autres liés directement)
  const withAccount = r.shuffle(clients).slice(0, 80);
  const viaCode = withAccount.slice(0, 8);
  for (const c of withAccount) {
    const authId = uuid();
    const email = `c-${c.id}@clients.yourfood.invalid`;
    await sim.q('insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)', [authId, email, JSON.stringify({ display_name: `${c.first} ${c.last}` })]);
    if (viaCode.includes(c)) {
      const code = await sim.rpc(admin, 'issue_customer_access_code', [c.id, 'activation']);
      if (!code.ok) throw new Error('code : ' + code.msg);
      c.activationCode = code.value;
      c.pendingAuth = authId; // lié plus tard, pendant la simulation (cas A1)
    } else {
      await sim.q('update public.customers set auth_user_id = $1 where id = $2', [authId, c.id]);
      c.uid = authId;
    }
  }
  for (const c of clients) c.hasAccount = withAccount.includes(c);

  // ── Profils de comportement (clients avec compte uniquement)
  const personas = [['early', 0.25], ['late', 0.15], ['changer', 0.10], ['canceller', 0.08], ['resumer', 0.07], ['ghost', 0.25], ['lastminute', 0.05], ['sporadic', 0.05]];
  for (const c of withAccount) {
    let x = r.next(), acc = 0;
    for (const [name, p] of personas) { acc += p; if (x < acc) { c.persona = name; break; } }
    c.persona ||= 'ghost';
  }

  return { org, team, admin, plans, items, clients, pairs: pairs.map(([a, b]) => [clients[a], clients[b]]) };
}

module.exports = { seed, PLATS, ACCS, VIANDES };
