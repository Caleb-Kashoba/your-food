'use strict';
/**
 * Calendrier « la veille » : on commande le repas de demain jusqu'à 20 h aujourd'hui (le lundi : le dimanche à 20 h),
 * on prépare et on livre le lendemain. Scénario ciblé sur la base locale (voir README.md) :
 *   SIM_DB=fusion_sim node veille.js
 */
const { Client, CFG, Sim, Journal, rng } = require('./lib');
const { seed, PLATS, ACCS, VIANDES } = require('./seed');

(async () => {
  const db = new Client(CFG);
  await db.connect();
  const J = new Journal();
  const sim = new Sim(db, J);
  const r = rng(77);
  const W = await seed(sim, r, J);
  const { admin, team, items, clients, plans } = W;
  const C = (id, title, expected, actual, ok, day) => J.caseResult(id, 'veille', title, expected, actual, ok, day);
  const rejected = (res, re) => !res.ok && (!re || re.test(res.msg));
  const ids = (names) => names.map((n) => items[n].id);
  const names = [...PLATS.slice(0, 3), ...ACCS.slice(0, 2), ...VIANDES.slice(0, 2)];

  const withAccount = clients.filter((c) => c.uid && c.subs[0]);
  const a5 = withAccount.filter((c) => c.group === 'A5');
  const g = withAccount.filter((c) => c.group === 'G');
  const noAccount = clients.filter((c) => !c.uid && !c.pendingAuth && c.group === 'A5');
  const f1 = a5.find((c) => c.plan === 'F1');
  const f2 = a5.find((c) => c.plan === 'F2');
  const pick = (m, cat) => m.menu.options.find((o) => o.category === cat).option_id;
  const order = (c, m, withMeat) => sim.rpc(c.uid, 'submit_my_order', [m.menu.id, pick(m, 'plat'), pick(m, 'accompagnement'), withMeat ? pick(m, 'viande') : null]);
  const view = async (c) => (await sim.rpc(c.uid, 'my_today_menu', [])).value;

  // ── Les menus de la semaine du 5 octobre, publiés le vendredi 2
  await sim.clock('2026-10-02', '12:00:00');
  const pub = await sim.rpc(admin, 'publish_menus', ['2026-10-05', 5, ids(names), '13:00']);
  C('V0', 'publier la semaine suivante le vendredi', '5 menus', pub.ok ? `${pub.value.created.length}` : pub.msg, pub.ok && pub.value.created.length === 5, '2026-10-02');

  // ── Vendredi et samedi : pas de menu à commander (demain est un week-end)
  for (const [day, id] of [['2026-10-02', 'V1'], ['2026-10-03', 'V2']]) {
    await sim.clock(day, '10:00:00');
    const m = await view(a5[0]);
    C(id, `${day} : le menu de demain (week-end) n'existe pas, le prochain est annoncé`, 'aucun_menu, prochain 2026-10-05', `${m.menu_status}, prochain ${m.next_menu_date}`, m.menu_status === 'aucun_menu' && m.next_menu_date === '2026-10-05', day);
  }
  await sim.clock('2026-10-03', '15:00:00');
  const mon = await sim.one(`select id from public.daily_menus where menu_date = '2026-10-05'`);
  const early = await sim.rpc(a5[0].uid, 'submit_my_order', [mon.id, null, null, null]);
  C('V3', 'samedi : commander le lundi est trop tôt (on commande la veille)', 'refusé', early.ok ? 'accepté' : early.msg, rejected(early, /repas de demain/), '2026-10-03');

  // ── Dimanche 4 octobre : le lundi se commande le dimanche
  await sim.clock('2026-10-04', '10:00:00');
  const sun = await view(f1);
  C('V4', 'dimanche : le client voit le menu du lundi 5, état normal, avec le verrouillage du jour', 'date 2026-10-05, normal, lock_date 2026-10-04', `${sun.date}, ${sun.menu_status}, ${sun.menu?.lock_date}`, sun.date === '2026-10-05' && sun.menu_status === 'normal' && sun.menu.lock_date === '2026-10-04', '2026-10-04');
  C('V4b', 'lundi = Formule 1 : viande incluse', 'oui', String(sun.meat_allowed_today), sun.meat_allowed_today === true, '2026-10-04');
  const ok1 = await order(f1, sun, true);
  const ok2 = await order(f2, sun, true);
  C('V5', 'dimanche : commande du lundi acceptée', 'acceptée', ok1.ok && ok2.ok ? 'acceptée' : (ok1.msg || ok2.msg), ok1.ok && ok2.ok, '2026-10-04');

  // Le client dont l'abonnement commence lundi ne commande pas son premier repas
  const first = g.find((c) => c.subs[0].start === '2026-10-05');
  const fv = await view(first);
  C('V6', 'abonnement qui commence lundi : le premier repas est attribué automatiquement (dimanche, pas de commande)', 'first_day_default', String(fv.first_day_default), fv.first_day_default === true, '2026-10-04');
  const fo = await order(first, fv, first.plan === 'F2');
  C('V6b', 'et la commande lui est refusée avec un message clair', 'refusé « commence demain »', fo.ok ? 'accepté' : fo.msg, rejected(fo, /commence demain/), '2026-10-04');
  const fc = await sim.rpc(first.uid, 'cancel_my_order', [fv.menu.id]);
  C('V6c', 'l\'annulation aussi', 'refusée', fc.ok ? 'acceptée' : fc.msg, rejected(fc, /commence demain/), '2026-10-04');

  // ── Limite : dimanche 19:59:59 / 20:00:00
  await sim.clock('2026-10-04', '19:59:59');
  const late = await order(a5[1], sun, a5[1].plan === 'F2');
  C('V7', 'dimanche 19:59:59 : commande du lundi acceptée', 'acceptée', late.ok ? 'acceptée' : late.msg, late.ok, '2026-10-04');
  await sim.clock('2026-10-04', '20:00:00');
  const closed = await order(a5[2], sun, a5[2].plan === 'F2');
  const closedCancel = await sim.rpc(a5[2].uid, 'cancel_my_order', [sun.menu.id]);
  C('V8', 'dimanche 20:00:00 : commande et annulation refusées', 'refusées', `${closed.ok ? 'acceptée' : 'refusée'} / ${closedCancel.ok ? 'acceptée' : 'refusée'}`, rejected(closed, /verrouillé/) && rejected(closedCancel, /verrouillé/), '2026-10-04');

  // ── Verrouillage planifié (20:00:30) : repas par défaut, journal « système »
  await sim.clock('2026-10-04', '20:00:30');
  const before = (await sim.one(`select count(*)::int n from public.meal_orders`)).n;
  const created = (await sim.one('select public.lock_due_menus() as n')).n;
  const waiting = (await sim.one(`select count(*)::int n from public.deliveries where delivery_date = '2026-10-05' and status <> 'cancelled'`)).n;
  const orders = (await sim.one(`select count(*)::int n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-05'`)).n;
  C('V9', 'à 20:00:30 le menu du lundi est verrouillé : tous les clients attendus lundi ont un repas', `${waiting} commandes`, `${orders} (dont ${created} par défaut)`, orders === waiting && created > 0, '2026-10-04');
  const menuStatus = (await sim.one(`select status from public.daily_menus where menu_date = '2026-10-05'`)).status;
  const tueStatus = (await sim.one(`select status from public.daily_menus where menu_date = '2026-10-06'`)).status;
  C('V9b', 'le menu du mardi reste ouvert', 'locked / open', `${menuStatus} / ${tueStatus}`, menuStatus === 'locked' && tueStatus === 'open', '2026-10-04');
  const firstOrder = await sim.one(`select o.is_default from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-05' and o.customer_id = $1`, [first.id]);
  C('V9c', 'le client du premier jour reçoit bien un repas par défaut', 'par défaut', firstOrder ? (firstOrder.is_default ? 'par défaut' : 'choisi') : 'aucun', firstOrder && firstOrder.is_default, '2026-10-04');
  const wrongActor = (await sim.one(`select count(*)::int n from public.audit_logs a join public.meal_orders o on o.id::text = a.entity_id where a.entity_type = 'meal_orders' and a.action = 'insert' and o.is_default and a.actor_user_id is not null`)).n;
  C('V9d', 'les repas par défaut ne sont attribués à personne dans le journal', '0', String(wrongActor), wrongActor === 0, '2026-10-04');
  void before;

  // ── Lundi 5 octobre : repas du jour en lecture seule, menu de mardi à commander
  await sim.clock('2026-10-05', '08:00:00');
  const mv = await view(f1);
  C('V10', 'lundi : le client voit le repas d\'aujourd\'hui (commandé hier) et le menu de demain ouvert', 'today_meal avec plat, menu mardi normal', `${mv.today_meal?.plat ? 'plat ok' : 'sans plat'}, ${mv.date} ${mv.menu_status}`, Boolean(mv.today_meal?.plat) && mv.date === '2026-10-06' && mv.menu_status === 'normal', '2026-10-05');
  C('V10b', 'mardi : pas de viande pour la Formule 1', 'non', String(mv.meat_allowed_today), mv.meat_allowed_today === false, '2026-10-05');
  const tue = await sim.rpc(f1.uid, 'submit_my_order', [mv.menu.id, pick(mv, 'plat'), pick(mv, 'accompagnement'), pick(mv, 'viande')]);
  C('V10c', 'mardi : une viande est refusée à la Formule 1', 'refusée', tue.ok ? 'acceptée' : tue.msg, rejected(tue, /viande/), '2026-10-05');
  const tue2 = await order(f1, mv, false);
  C('V10d', 'mardi : sans viande, acceptée', 'acceptée', tue2.ok ? 'acceptée' : tue2.msg, tue2.ok, '2026-10-05');
  const gtue = await order(first, await view(first), first.plan === 'F2');
  C('V11', 'lundi : le client dont l\'abonnement a commencé peut maintenant commander mardi', 'acceptée', gtue.ok ? 'acceptée' : gtue.msg, gtue.ok, '2026-10-05');

  // ── Avis : pas avant le jour du repas
  await sim.clock('2026-10-04', '21:00:00');
  const mondayOrder = await sim.one(`select o.id from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-05' and o.customer_id = $1`, [f1.id]);
  const tooSoon = await sim.rpc(f1.uid, 'submit_my_review', [mondayOrder.id, 5, null]);
  const hist0 = await sim.rpc(f1.uid, 'my_history', [null, null, null]);
  C('V12', 'dimanche soir : le repas de lundi est verrouillé mais pas encore servi → avis refusé, absent de l\'historique', 'refusé, 0 ligne', `${tooSoon.ok ? 'accepté' : 'refusé'}, ${hist0.value.length} ligne(s)`, rejected(tooSoon, /une fois le repas servi/) && hist0.value.length === 0, '2026-10-04');
  await sim.clock('2026-10-05', '14:00:00');
  const served = await sim.rpc(f1.uid, 'submit_my_review', [mondayOrder.id, 4, 'Bon']);
  C('V12b', 'lundi : avis accepté le jour du repas', 'accepté', served.ok ? 'accepté' : served.msg, served.ok, '2026-10-05');

  // ── Saisie par l'équipe, même après 20 h (le bol n'est pas encore prêt)
  const nobody = noAccount[0];
  await sim.clock('2026-10-05', '21:30:00'); // le menu de mardi est verrouillé depuis 20 h
  await sim.one('select public.lock_due_menus()');
  const ctx = await sim.rpc(team.manager, 'staff_order_context', [nobody.id, '2026-10-06']);
  const opts = ctx.value.options;
  const op = (cat) => opts.find((o) => o.category === cat).option_id;
  C('V13', 'équipe : le menu de mardi est verrouillé mais la saisie reste possible', 'editable', ctx.ok ? `editable=${ctx.value.editable} locked=${ctx.value.menu_locked}` : ctx.msg, ctx.ok && ctx.value.editable && ctx.value.menu_locked, '2026-10-05');
  const meat = ctx.value.meat_allowed;
  const set = await sim.rpc(team.manager, 'staff_set_order', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), meat ? op('viande') : null]);
  C('V13b', 'le manager saisit le repas d\'un client sans compte après 20 h', 'accepté', set.ok ? 'accepté' : set.msg, set.ok, '2026-10-05');
  const row = await sim.one(`select o.is_default, o.status from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-06' and o.customer_id = $1`, [nobody.id]);
  C('V13c', 'ce repas n\'est plus « par défaut »', 'confirmé, choisi', row ? `${row.status}, ${row.is_default ? 'défaut' : 'choisi'}` : 'aucun', row && row.status === 'confirmed' && !row.is_default, '2026-10-05');
  const actor = await sim.one(`select a.actor_member_id, a.actor_user_id from public.audit_logs a join public.meal_orders o on o.id::text = a.entity_id join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-06' and o.customer_id = $1 order by a.created_at desc limit 1`, [nobody.id]);
  C('V13d', 'le journal attribue la saisie à la personne de l\'équipe', 'auteur renseigné', actor && actor.actor_member_id ? 'auteur renseigné' : 'sans auteur', Boolean(actor && actor.actor_member_id), '2026-10-05');
  const badOpt = await sim.rpc(team.manager, 'staff_set_order', [nobody.id, '2026-10-06', op('accompagnement'), op('accompagnement'), null]);
  C('V13e', 'option de la mauvaise catégorie refusée', 'refusé', badOpt.ok ? 'accepté' : badOpt.msg, rejected(badOpt, /Choisis/), '2026-10-05');
  const staffNo = await sim.rpc(team.staff, 'staff_set_order', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), null]);
  const clientNo = await sim.rpc(f2.uid, 'staff_set_order', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), null]);
  const anonNo = await sim.anon((x) => x.query('select public.staff_set_order($1,$2,$3,$4,$5)', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), null]));
  C('V13f', 'cuisine, client et anonyme ne peuvent pas saisir un repas', '3 refus', `${[staffNo, clientNo, anonNo].filter((x) => !x.ok).length} refus`, !staffNo.ok && !clientNo.ok && !anonNo.ok, '2026-10-05');
  const cancel = await sim.rpc(admin, 'staff_cancel_order', [nobody.id, '2026-10-06']);
  const dlRow = await sim.one(`select status, cancellation_reason from public.deliveries where customer_id = $1 and delivery_date = '2026-10-06'`, [nobody.id]);
  C('V13g', 'annulation par l\'équipe : livraison annulée', 'cancelled', cancel.ok ? dlRow.status : cancel.msg, cancel.ok && dlRow.status === 'cancelled', '2026-10-05');
  const back = await sim.rpc(admin, 'staff_set_order', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), meat ? op('viande') : null]);
  const dlBack = await sim.one(`select status from public.deliveries where customer_id = $1 and delivery_date = '2026-10-06'`, [nobody.id]);
  C('V13h', 'ressaisir le repas rétablit la livraison', 'scheduled', back.ok ? dlBack.status : back.msg, back.ok && dlBack.status === 'scheduled', '2026-10-05');

  // Le bol prêt ne se change plus ; un jour passé non plus
  await sim.rpc(team.staff, 'update_delivery_status', [(await sim.one(`select id from public.deliveries where customer_id = $1 and delivery_date = '2026-10-06'`, [nobody.id])).id, 'ready']);
  const afterReady = await sim.rpc(admin, 'staff_set_order', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), meat ? op('viande') : null]);
  C('V14', 'bol marqué prêt : la saisie est refusée', 'refusée', afterReady.ok ? 'acceptée' : afterReady.msg, rejected(afterReady, /prêt ou livré/), '2026-10-05');
  await sim.clock('2026-10-07', '09:00:00');
  const past = await sim.rpc(admin, 'staff_set_order', [nobody.id, '2026-10-06', op('plat'), op('accompagnement'), null]);
  C('V14b', 'jour passé : refusé', 'refusée', past.ok ? 'acceptée' : past.msg, rejected(past, /passé|prêt/), '2026-10-07');

  // ── Publication : demain doit être publié avant 20 h aujourd'hui
  await sim.clock('2026-10-11', '19:00:00');
  const w2 = await sim.rpc(admin, 'publish_menu', ['2026-10-12', ids(names), '13:00']);
  C('V15', 'dimanche 19:00 : publier le menu du lundi est possible', 'accepté', w2.ok ? 'accepté' : w2.msg, w2.ok, '2026-10-11');
  await sim.clock('2026-10-11', '20:30:00');
  const w3 = await sim.rpc(admin, 'publish_menu', ['2026-10-13', ids(names), '13:00']);
  C('V15b', 'dimanche 20:30 : publier le menu du mardi reste possible (il se verrouille lundi à 20 h)', 'accepté', w3.ok ? 'accepté' : w3.msg, w3.ok, '2026-10-11');
  const w4 = await sim.rpc(admin, 'publish_menu', ['2026-10-12', ids(names.slice(0, 5)), '13:00']);
  C('V15c', 'republier le menu du lundi, verrouillé depuis 20:00, est refusé', 'refusé', w4.ok ? 'accepté' : w4.msg, !w4.ok, '2026-10-11');

  // ── « Bientôt expiré » : abonnement d'une semaine, puis d'un mois
  const weekly = clients.find((c) => !c.subs.length && c.group === 'F');
  const wsub = await sim.rpc(admin, 'create_subscription_weeks', [weekly.id, plans.F2, '2026-10-12', 1, null, null, null]);
  const monthly = clients.find((c) => c.group === 'F' && c !== weekly);
  const msub = await sim.rpc(admin, 'create_subscription_weeks', [monthly.id, plans.F2, '2026-10-12', 4, null, null, null]);
  const stateOn = async (c, d) => (await sim.one('select public.customer_subscription_context($1, $2::date) ->> \'state\' as s', [c.id, d])).s;
  const wk = [await stateOn(weekly, '2026-10-12'), await stateOn(weekly, '2026-10-14'), await stateOn(weekly, '2026-10-15'), await stateOn(weekly, '2026-10-16')];
  C('V16', 'abonnement d\'une semaine : actif lundi et mercredi, bientôt expiré jeudi et vendredi', 'actif, actif, bientot_expire, bientot_expire', wk.join(', '), wk.join() === 'actif,actif,bientot_expire,bientot_expire' && wsub.ok, '2026-10-12');
  const mo = [await stateOn(monthly, '2026-10-12'), await stateOn(monthly, '2026-10-29'), await stateOn(monthly, '2026-11-02'), await stateOn(monthly, '2026-11-05')];
  C('V16b', 'abonnement d\'un mois : actif jusqu\'à 6 jours ouvrés avant la fin, bientôt expiré les 5 derniers', 'actif, actif, bientot_expire, bientot_expire', mo.join(', '), mo.join() === 'actif,actif,bientot_expire,bientot_expire' && msub.ok, '2026-10-12');
  await sim.clock('2026-10-12', '09:00:00');
  const ov = async (d, c) => {
    await sim.clock(d, '09:00:00');
    return (await sim.one('select effective_status s from public.subscription_overview where customer_id = $1', [c.id])).s;
  };
  const ow = [await ov('2026-10-12', weekly), await ov('2026-10-13', weekly), await ov('2026-10-14', weekly), await ov('2026-10-16', weekly)];
  C('V17', 'vue administratrice, abonnement d\'une semaine : active, active, expiring_soon (2 jours avant la fin), expires_today', 'active, active, expiring_soon, expires_today', ow.join(', '), ow.join() === 'active,active,expiring_soon,expires_today', '2026-10-16');

  // ── Alerte de sécurité : search_path fixé
  const sp = await sim.q(`select p.proname, p.proconfig::text c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('meat_allowed','meat_allowed_ctx','normalize_login_text','customer_tech_email')`);
  C('V18', 'search_path fixé sur les 4 petites fonctions', '4', String(sp.filter((x) => /search_path/.test(x.c || '')).length), sp.length === 4 && sp.every((x) => /search_path/.test(x.c || '')), '2026-10-12');

  // ── Invariants du jour verrouillé du 5 octobre
  const dupes = (await sim.one(`select count(*)::int n from (select customer_id from public.meal_orders group by daily_menu_id, customer_id having count(*) > 1) t`)).n;
  const noOrder = (await sim.one(`select count(*)::int n from public.deliveries dl join public.daily_menus dm on dm.menu_date = dl.delivery_date and dm.status = 'locked' where dl.status <> 'cancelled' and not exists (select 1 from public.meal_orders o where o.daily_menu_id = dm.id and o.customer_id = dl.customer_id)`)).n;
  C('V19', 'après tous les verrouillages : aucun doublon, aucune livraison sans commande', '0, 0', `${dupes}, ${noOrder}`, dupes === 0 && noOrder === 0, '2026-10-12');

  const failed = J.cases.filter((c) => !c.ok);
  for (const c of J.cases) console.log(`${c.ok ? 'OK   ' : 'ECHEC'} ${c.id.padEnd(5)} ${c.title}${c.ok ? '' : `\n         attendu : ${c.expected}\n         constaté : ${c.actual}`}`);
  console.log(`\n${J.cases.length - failed.length}/${J.cases.length} conformes`);
  await db.end();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
