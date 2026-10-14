'use strict';
/**
 * Abonnement qui commence un jour ouvré quelconque : durée en jours ouvrés (une semaine = 5 jours ouvrés),
 * rallongement à la suite de la fin, abonnement suivant le jour ouvré qui suit la fin.
 * Chaque cas dit ce qu'on ATTEND ; un cas en échec est une faille.
 *   SIM_DB=fusion_sim node weekday-start.js   (sur une base vierge : setup-db.sh)
 */
const { Client, CFG, Sim, Journal, rng } = require('./lib');
const { seed } = require('./seed');

(async () => {
  const db = new Client(CFG);
  await db.connect();
  const J = new Journal();
  const sim = new Sim(db, J);
  const W = await seed(sim, rng(88), J);
  const { admin, plans, clients } = W;
  const C = (id, title, expected, actual, ok, day) => J.caseResult(id, 'abonnement', title, expected, actual, ok, day);
  const rejected = (res, re) => !res.ok && (!re || re.test(res.msg));
  const free = clients.filter((c) => c.group === 'F'); // clients sans abonnement
  const sub = (id) => sim.one(`select start_date::text s, end_date::text e, applied_price::numeric p, applied_duration_value::int w, plan_id from public.subscriptions where id = $1`, [id]);
  const days = async (id) => (await sim.q(`select delivery_date::text d from public.deliveries where subscription_id = $1 and status <> 'cancelled' order by 1`, [id])).map((x) => x.d);
  const create = (c, plan, start, weeks) => sim.rpc(admin, 'create_subscription_weeks', [c.id, plan, start, weeks, null, null, null]);

  await sim.clock('2026-10-13', '10:00:00'); // mardi

  // ── Début en milieu de semaine : mercredi 14, 1 semaine = 5 jours ouvrés → mardi 20
  const c1 = free[0];
  const a = await create(c1, plans.F2, '2026-10-14', 1);
  const sa = a.ok ? await sub(a.value) : null;
  const da = a.ok ? await days(a.value) : [];
  C('W1', 'début un mercredi, 1 semaine : du mercredi 14 au mardi 20 (5 jours ouvrés), prix d\'une semaine, 5 livraisons sans week-end',
    '14 → 20 ; 5 livraisons 14, 15, 16, 19, 20 ; prix 35000', a.ok ? `${sa.s} → ${sa.e} ; ${da.join(', ')} ; ${Number(sa.p)}` : a.msg,
    a.ok && sa.s === '2026-10-14' && sa.e === '2026-10-20' && da.join(',') === '2026-10-14,2026-10-15,2026-10-16,2026-10-19,2026-10-20' && Number(sa.p) === 35000, '2026-10-13');

  // ── Rallonger d'une semaine : 5 jours ouvrés de plus à la suite (mardi 20 → mardi 27), prix + 1 semaine
  const ext = await sim.rpc(admin, 'extend_subscription_weeks', [a.value, 1, 'Une semaine de plus']);
  const sx = await sub(a.value);
  const dx = await days(a.value);
  C('W2', 'rallonger d\'une semaine un abonnement du mercredi au mardi : il continue jusqu\'au mardi 27 (5 jours ouvrés de plus), prix doublé',
    'fin 2026-10-27 ; 10 livraisons ; prix 70000 ; 2 semaines', ext.ok ? `fin ${sx.e} ; ${dx.length} livraisons ; prix ${Number(sx.p)} ; ${sx.w} semaines` : ext.msg,
    ext.ok && sx.e === '2026-10-27' && dx.length === 10 && Number(sx.p) === 70000 && sx.w === 2 && dx.every((d) => ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())), '2026-10-13');

  // ── Un début un lundi garde la logique du lundi au vendredi
  const c2 = free[1];
  const m = await create(c2, plans.F1, '2026-10-19', 2);
  const sm = m.ok ? await sub(m.value) : null;
  C('W3', 'début un lundi, 2 semaines : toujours du lundi 19 au vendredi 30', '2026-10-19 → 2026-10-30', m.ok ? `${sm.s} → ${sm.e}` : m.msg, m.ok && sm.s === '2026-10-19' && sm.e === '2026-10-30', '2026-10-13');

  // ── Début un vendredi : 1 semaine = vendredi → jeudi suivant
  const c3 = free[2];
  const f = await create(c3, plans.F2, '2026-10-16', 1);
  const sf = f.ok ? await sub(f.value) : null;
  C('W4', 'début un vendredi, 1 semaine : du vendredi 16 au jeudi 22', '2026-10-16 → 2026-10-22', f.ok ? `${sf.s} → ${sf.e}` : f.msg, f.ok && sf.e === '2026-10-22', '2026-10-13');

  // ── Week-end refusé
  const c4 = free[3];
  const sat = await create(c4, plans.F2, '2026-10-17', 1);
  const sun = await create(c4, plans.F2, '2026-10-18', 1);
  C('W5', 'début un samedi ou un dimanche refusé', 'deux refus « jour ouvré »', `${sat.ok ? 'accepté' : sat.msg} / ${sun.ok ? 'accepté' : sun.msg}`, rejected(sat, /jour ouvré/) && rejected(sun, /jour ouvré/), '2026-10-13');

  // ── Abonnement suivant avec une autre formule : le jour ouvré qui suit la fin (mardi 20 → mercredi 21)
  await sim.clock('2026-10-20', '10:00:00'); // l'abonnement du 16 au 22 est alors en cours
  const next = await sim.rpc(admin, 'renew_subscription_weeks', [c3.id, 1, plans.F1, null, null]);
  const sn = next.ok ? await sub(next.value) : null;
  C('W6', 'autre formule : l\'abonnement suivant commence le jour ouvré qui suit la fin (jeudi 22 → vendredi 23)', 'début 2026-10-23, fin 2026-10-29', next.ok ? `${sn.s} → ${sn.e}` : next.msg,
    next.ok && sn.s === '2026-10-23' && sn.e === '2026-10-29', '2026-10-13');

  // ── Modifier les dates : la durée en semaines se compte en jours ouvrés
  const mod = await sim.rpc(admin, 'modify_subscription', [a.value, '2026-10-14', '2026-10-20', 'Retour à une semaine']);
  const smod = await sub(a.value);
  C('W7', 'modifier les dates (mercredi → mardi suivant) : la durée redevient 1 semaine (5 jours ouvrés)', '1 semaine', mod.ok ? `${smod.w} semaine(s)` : mod.msg, mod.ok && smod.w === 1, '2026-10-13');

  console.log('\n=== ABONNEMENT QUI COMMENCE EN SEMAINE ===');
  for (const c of J.cases) console.log(`${c.ok ? 'OK    ' : 'FAILLE'} ${c.id} — ${c.title}\n        attendu : ${c.expected}\n        constaté : ${c.actual}`);
  await db.end();
  process.exit(J.cases.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
