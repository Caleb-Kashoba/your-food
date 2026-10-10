'use strict';
/**
 * Statut des clients : actif / inactif (2 jours ouvrés après la fin) / ancien client (approbation, refus = +2 semaines).
 * Chaque cas dit ce qu'on ATTEND ; un cas en échec est une faille.
 *   SIM_DB=fusion_sim node customer-status.js
 */
const { Client, CFG, Sim, Journal, rng } = require('./lib');
const { seed } = require('./seed');

(async () => {
  const db = new Client(CFG);
  await db.connect();
  const J = new Journal();
  const sim = new Sim(db, J);
  const W = await seed(sim, rng(91), J);
  const { admin, org, plans, clients } = W;
  const C = (id, title, expected, actual, ok, day) => J.caseResult(id, 'statut', title, expected, actual, ok, day);
  const nightly = () => sim.q('select public.refresh_customer_statuses() as n');
  const status = async (id) => (await sim.one('select status::text s, former_review_at::text r, former_refusals::int f from public.customers where id = $1', [id]));
  const proposals = async () => {
    const res = await sim.rpc(admin, 'former_customer_proposals', []);
    return res.ok ? res.value : null;
  };
  const inList = (list, id) => Boolean(list && list.find((p) => p.customer_id === id));
  let n = 0;
  const person = async (label) => {
    n += 1;
    const res = await sim.as(admin, (d) => d.query(
      `insert into public.customers (organization_id, first_name, last_name, phone) values ($1,$2,$3,$4) returning id`,
      [org, 'Statut', label, `+24399${String(5000000 + n)}`]).then((x) => x.rows[0].id));
    if (!res.ok) throw new Error(res.msg);
    return res.value;
  };
  const subscribe = async (customer, plan, start, weeks) => {
    const res = await sim.rpc(admin, 'create_subscription_weeks', [customer, plan, start, weeks, null, null, null]);
    if (!res.ok) throw new Error('abonnement : ' + res.msg);
    return res.value;
  };

  // Calcul : 2 jours ouvrés
  const bd = async (d, k) => (await sim.one('select public.add_business_days($1::date, $2)::text d', [d, k])).d;
  C('S0', 'jours ouvrés : vendredi 9 + 2 = mardi 13 ; mercredi 7 + 2 = vendredi 9 ; jeudi 8 + 2 = lundi 12',
    '2026-10-13, 2026-10-09, 2026-10-12', [await bd('2026-10-09', 2), await bd('2026-10-07', 2), await bd('2026-10-08', 2)].join(', '),
    (await bd('2026-10-09', 2)) === '2026-10-13' && (await bd('2026-10-07', 2)) === '2026-10-09' && (await bd('2026-10-08', 2)) === '2026-10-12', '2026-10-09');

  // Cinq clients abonnés du 5 au 9 octobre (créés le 2)
  await sim.clock('2026-10-02', '10:00:00');
  const never = await person('Jamais');          // aucun abonnement
  const lapsed = await person('Termine');        // 5 → 9, pas renouvelé
  const renewed = await person('Renouvelle');    // 5 → 9 puis 12 → 16
  const paused = await person('Suspendu');       // 5 → 16, suspendu
  const dropped = await person('Annule');        // 5 → 9 annulé
  const subLapsed = await subscribe(lapsed, plans.F2, '2026-10-05', 1);
  const subRenewed = await subscribe(renewed, plans.F2, '2026-10-05', 1);
  const subPaused = await subscribe(paused, plans.F2, '2026-10-05', 2);
  const subDropped = await subscribe(dropped, plans.F2, '2026-10-05', 1);
  void subLapsed; void subRenewed;
  await sim.rpc(admin, 'set_subscription_status', [subPaused, 'suspended', 'Voyage']);
  await sim.rpc(admin, 'set_subscription_status', [subDropped, 'cancelled', 'Erreur de saisie']);

  // Vendredi 9 : le client renouvelle pour la semaine suivante
  await sim.clock('2026-10-09', '15:00:00');
  await subscribe(renewed, plans.F2, '2026-10-12', 1);

  // Fenêtre de grâce : vendredi soir, lundi, mardi (2 jours ouvrés après la fin du vendredi 9)
  await sim.clock('2026-10-09', '23:00:00'); await nightly();
  const s1 = await status(lapsed);
  C('S1', 'abonnement fini vendredi : toujours actif le soir même', 'active', s1.s, s1.s === 'active', '2026-10-09');
  await sim.clock('2026-10-13', '23:30:00'); await nightly();
  const s2 = await status(lapsed);
  C('S2', 'mardi 13 au soir (2 jours ouvrés écoulés, pas plus) : encore actif', 'active', s2.s, s2.s === 'active', '2026-10-13');
  await sim.clock('2026-10-14', '00:05:00'); await nightly();
  const s3 = await status(lapsed);
  C('S3', 'mercredi 14, après le calcul de nuit : inactif', 'inactive', s3.s, s3.s === 'inactive', '2026-10-14');

  const sRen = await status(renewed);
  C('S4', 'abonnement renouvelé (12 → 16) : reste actif', 'active', sRen.s, sRen.s === 'active', '2026-10-14');
  const sPause = await status(paused);
  C('S5', 'abonnement suspendu mais en cours : reste actif', 'active', sPause.s, sPause.s === 'active', '2026-10-14');
  const sDrop = await status(dropped);
  const sNever = await status(never);
  C('S6', 'abonnement annulé seul ou jamais abonné : statut non touché (actif)', 'active, active', `${sDrop.s}, ${sNever.s}`, sDrop.s === 'active' && sNever.s === 'active', '2026-10-14');

  // Réactivation immédiate (sans attendre la nuit) : un nouvel abonnement remet le client en actif
  await sim.clock('2026-10-14', '09:00:00');
  const back = await person('Revenu');
  await sim.clock('2026-10-02', '10:00:00');
  const subBack = await subscribe(back, plans.F2, '2026-10-05', 1);
  void subBack;
  await sim.clock('2026-10-14', '00:05:00'); await nightly();
  const sBack0 = await status(back);
  await sim.clock('2026-10-14', '09:00:00');
  await subscribe(back, plans.F2, '2026-10-19', 1);
  const sBack1 = await status(back);
  C('S7', 'client inactif : un nouvel abonnement le remet actif aussitôt (sans attendre le calcul de nuit)', 'inactive puis active', `${sBack0.s} puis ${sBack1.s}`, sBack0.s === 'inactive' && sBack1.s === 'active', '2026-10-14');

  // Proposition « ancien client » : un mois après la fin (9 oct. + 30 jours = 8 nov.)
  await sim.clock('2026-11-07', '09:00:00'); await nightly();
  const p7 = await proposals();
  C('S8', 'veille du mois (7 nov.) : pas encore proposé', 'absent', inList(p7, lapsed) ? 'présent' : 'absent', p7 !== null && !inList(p7, lapsed), '2026-11-07');
  await sim.clock('2026-11-08', '09:00:00'); await nightly();
  const p8 = await proposals();
  const mine8 = p8 && p8.find((p) => p.customer_id === lapsed);
  C('S9', '8 nov. (un mois après la fin) : proposé, 30 jours d\'inactivité, aucun refus', 'présent, 30 jours, 0 refus', mine8 ? `${mine8.inactive_days} jours, ${mine8.refusals} refus` : 'absent',
    Boolean(mine8) && mine8.inactive_days === 30 && mine8.refusals === 0, '2026-11-08');
  C('S10', 'les clients actifs ou jamais abonnés ne sont jamais proposés', 'aucun des 4 autres', [renewed, paused, dropped, never].filter((id) => inList(p8, id)).length + ' proposé(s)',
    [renewed, paused, dropped, never].every((id) => !inList(p8, id)), '2026-11-08');

  // Refus : +2 semaines à chaque fois
  const refuse1 = await sim.rpc(admin, 'decide_former_customer', [lapsed, false]);
  const afterRefuse = await status(lapsed);
  C('S11', 'refus : le client reste inactif, prochaine proposition dans 2 semaines (22 nov.)', 'reported, inactive, 2026-11-22, 1 refus',
    `${refuse1.ok ? refuse1.value : refuse1.msg}, ${afterRefuse.s}, ${afterRefuse.r}, ${afterRefuse.f} refus`,
    refuse1.ok && refuse1.value === 'reported' && afterRefuse.s === 'inactive' && afterRefuse.r === '2026-11-22' && afterRefuse.f === 1, '2026-11-08');
  await sim.clock('2026-11-21', '09:00:00'); await nightly();
  const p21 = await proposals();
  C('S12', '21 nov. : pas encore reproposé', 'absent', inList(p21, lapsed) ? 'présent' : 'absent', p21 !== null && !inList(p21, lapsed), '2026-11-21');
  await sim.clock('2026-11-22', '09:00:00'); await nightly();
  const p22 = await proposals();
  const mine22 = p22 && p22.find((p) => p.customer_id === lapsed);
  C('S13', '22 nov. : reproposé, avec 1 refus', 'présent, 1 refus', mine22 ? `${mine22.refusals} refus` : 'absent', Boolean(mine22) && mine22.refusals === 1, '2026-11-22');
  const refuse2 = await sim.rpc(admin, 'decide_former_customer', [lapsed, false]);
  const afterRefuse2 = await status(lapsed);
  C('S14', 'deuxième refus : encore 2 semaines (6 déc.), 2 refus', 'reported, 2026-12-06, 2 refus', `${refuse2.ok ? refuse2.value : refuse2.msg}, ${afterRefuse2.r}, ${afterRefuse2.f} refus`,
    refuse2.ok && afterRefuse2.r === '2026-12-06' && afterRefuse2.f === 2, '2026-11-22');
  const early = await sim.rpc(admin, 'decide_former_customer', [lapsed, true]);
  C('S15', 'décider avant la date de report est refusé', 'erreur « n\'est plus à confirmer »', early.ok ? 'accepté' : early.msg, !early.ok && /plus à confirmer/.test(early.msg), '2026-11-22');

  // Approbation
  await sim.clock('2026-12-06', '09:00:00'); await nightly();
  const approve = await sim.rpc(admin, 'decide_former_customer', [lapsed, true]);
  const former = await status(lapsed);
  C('S16', 'approbation : ancien client', 'former_customer', `${approve.ok ? approve.value : approve.msg} / ${former.s}`, approve.ok && former.s === 'former_customer', '2026-12-06');
  await sim.clock('2026-12-07', '00:05:00'); await nightly();
  const stays = await status(lapsed);
  const pAfter = await proposals();
  C('S17', 'le calcul de nuit ne touche plus un ancien client, qui n\'est plus proposé', 'former_customer, absent de la liste', `${stays.s}, ${inList(pAfter, lapsed) ? 'présent' : 'absent'}`,
    stays.s === 'former_customer' && !inList(pAfter, lapsed), '2026-12-07');

  // Retour d'un ancien client
  await sim.clock('2026-12-07', '10:00:00');
  await subscribe(lapsed, plans.F1, '2026-12-14', 2);
  const returned = await status(lapsed);
  C('S18', 'un ancien client qui reprend un abonnement redevient actif, refus remis à zéro', 'active, 0 refus, pas de report', `${returned.s}, ${returned.f} refus, report ${returned.r}`,
    returned.s === 'active' && returned.f === 0 && returned.r === null, '2026-12-07');

  // Droits
  const noRight = clients.find((c) => c.uid);
  const denied = await sim.rpc(noRight.uid, 'former_customer_proposals', []);
  const deniedDecide = await sim.rpc(noRight.uid, 'decide_former_customer', [lapsed, true]);
  C('S19', 'un client ne peut ni voir les propositions ni décider', 'les deux refusés', `voir ${denied.ok ? 'accepté' : 'refusé'}, décider ${deniedDecide.ok ? 'accepté' : 'refusé'}`, !denied.ok && !deniedDecide.ok, '2026-12-07');
  const bulk = await sim.rpc(noRight.uid, 'refresh_customer_statuses', []);
  C('S20', 'le calcul de statut n\'est pas appelable par un utilisateur de l\'application', 'refusé', bulk.ok ? 'accepté' : 'refusé', !bulk.ok, '2026-12-07');

  console.log('\n=== STATUT DES CLIENTS ===');
  for (const c of J.cases) console.log(`${c.ok ? 'OK    ' : 'FAILLE'} ${c.id} — ${c.title}\n        attendu : ${c.expected}\n        constaté : ${c.actual}`);
  await db.end();
  process.exit(J.cases.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
