'use strict';
/**
 * Audit de la planification des repas : cas limites de l'algorithme des repas par défaut.
 * Chaque cas dit ce qu'on ATTEND d'un fonctionnement correct ; un cas en échec est une faille à corriger.
 *   SIM_DB=fusion_sim node audit-planning.js
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
  const { admin, items, clients } = W;
  const C = (id, title, expected, actual, ok, day) => J.caseResult(id, 'audit', title, expected, actual, ok, day);
  const ids = (names) => names.map((n) => items[n].id);
  const names = [...PLATS.slice(0, 3), ...ACCS.slice(0, 2), ...VIANDES.slice(0, 2)];
  const a5 = clients.filter((c) => c.uid && c.subs[0] && c.group === 'A5');
  const f2 = a5.filter((c) => c.plan === 'F2');
  const lock = () => sim.one('select public.lock_due_menus() as n');
  const tally = async (date) => {
    const res = await sim.rpc(admin, 'orders_live', [date]);
    return res.ok ? res.value.tallies.filter((t) => t.category === 'plat').reduce((s, t) => s + t.count, 0) : -1;
  };
  const optionsOf = (date, cat) => sim.q(
    `select o.id from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id join public.daily_menus dm on dm.id = o.daily_menu_id
     where dm.menu_date = $1 and c.category = $2 order by c.name asc`, [date, cat]);

  // Menus de la semaine du 5 octobre, publiés le vendredi 2 (repas par défaut créés tout de suite)
  await sim.clock('2026-10-02', '12:00:00');
  const pub = await sim.rpc(admin, 'publish_menus', ['2026-10-05', 5, ids(names), '13:00']);
  if (!pub.ok) throw new Error(pub.msg);

  // ── X1 : un abonnement suspendu APRÈS la création de ses repas par défaut
  await sim.clock('2026-10-05', '10:00:00');
  const gone = f2[0];
  const before = await tally('2026-10-07');
  const susp = await sim.rpc(admin, 'set_subscription_status', [gone.subs[0].id, 'suspended', 'Voyage']);
  const after = await tally('2026-10-07');
  const orphan = (await sim.one(`select count(*)::int n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id join public.deliveries dl on dl.id = o.delivery_id
     where dm.menu_date = '2026-10-07' and o.status = 'confirmed' and dl.status = 'cancelled'`)).n;
  C('X1', 'suspendre un abonnement : son repas de mercredi sort des totaux à préparer par la cuisine', `total ${before} → ${before - 1}, 0 commande confirmée sur livraison annulée`,
    `total ${before} → ${after}, ${orphan} commande(s) confirmée(s) sur livraison annulée`, susp.ok && after === before - 1 && orphan === 0, '2026-10-05');

  // ── X2 : l'équipe modifie un repas le jour même (menu verrouillé) → les repas par défaut des autres ne doivent pas bouger
  await sim.clock('2026-10-06', '00:00:30');
  await lock();
  await sim.clock('2026-10-06', '09:00:00');
  const plats = await optionsOf('2026-10-06', 'plat');
  const accs = await optionsOf('2026-10-06', 'accompagnement');
  const viandes = await optionsOf('2026-10-06', 'viande');
  const snap = async () => Object.fromEntries((await sim.q(
    `select o.customer_id, o.plat_option_id from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-06'`)).map((x) => [x.customer_id, x.plat_option_id]));
  const target = f2[1];
  const prepared = f2[2];
  await sim.q(`update public.deliveries set status = 'ready' where customer_id = $1 and delivery_date = '2026-10-06'`, [prepared.id]);
  const s0 = await snap();
  const edit = await sim.rpc(admin, 'staff_set_order', [target.id, '2026-10-06', plats[1].id, accs[0].id, viandes[0].id]);
  const s1 = await snap();
  const changed = Object.keys(s0).filter((k) => k !== target.id && s0[k] !== s1[k]);
  const preparedChanged = s0[prepared.id] !== s1[prepared.id];
  C('X2', 'saisie par l\'équipe le jour du repas : seul le repas de ce client change (les autres, dont un bol déjà prêt, restent identiques)', '0 autre repas modifié, bol prêt inchangé',
    `${changed.length} autre(s) repas modifié(s), bol prêt ${preparedChanged ? 'MODIFIÉ' : 'inchangé'}`, edit.ok && changed.length === 0 && !preparedChanged, '2026-10-06');

  // ── X3 : le menu du jour a été oublié (jeudi 8 non publié) ; l'administratrice s'en aperçoit le matin
  await sim.q(`delete from public.meal_orders where daily_menu_id = (select id from public.daily_menus where menu_date = '2026-10-08')`);
  await sim.q(`delete from public.menu_options where daily_menu_id = (select id from public.daily_menus where menu_date = '2026-10-08')`);
  await sim.q(`delete from public.daily_menus where menu_date = '2026-10-08'`);
  await sim.clock('2026-10-08', '07:30:00');
  const late = await sim.rpc(admin, 'publish_menu', ['2026-10-08', ids(names), '13:00']);
  C('X3', 'menu oublié : l\'administratrice peut encore le publier le matin du jour même (repas par défaut pour tous)', 'publication acceptée', late.ok ? 'acceptée' : late.msg, late.ok, '2026-10-08');

  // ── X4 : une livraison apparaît le jour du repas (abonnement saisi tard, renouvellement du lundi matin)
  const none = clients.find((c) => c.group === 'F');
  await sim.clock('2026-10-05', '09:00:00');
  const sub = await sim.rpc(admin, 'create_subscription_weeks', [none.id, W.plans.F2, '2026-10-05', 1, null, null, null]);
  await sim.q('select public.refresh_open_default_orders()');
  const dl = (await sim.one(`select count(*)::int n from public.deliveries where customer_id = $1 and delivery_date = '2026-10-05' and status <> 'cancelled'`, [none.id])).n;
  const ord = (await sim.one(`select count(*)::int n from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-05' and o.customer_id = $1`, [none.id])).n;
  C('X4', 'abonnement saisi le lundi matin pour le jour même : la livraison de lundi a un repas (par défaut) pour la cuisine', `livraison ${dl}, commande 1`, `livraison ${dl}, commande ${ord}${sub.ok ? '' : ' (' + sub.msg + ')'}`, sub.ok && dl === 1 && ord === 1, '2026-10-05');

  // ── X5–X8 : changement d'abonnement (le cas « Confiant ») : l'ancien abonnement est annulé, un nouveau le remplace
  await sim.clock('2026-10-06', '17:40:00');
  const swap = f2[3];
  const oldSub = swap.subs[0].id;
  const wed = '2026-10-07';
  const orderOn = (date) => sim.q(
    `select o.subscription_id, o.delivery_id, o.is_default, dl.status as livraison, dl.subscription_id as livraison_abo
     from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id left join public.deliveries dl on dl.id = o.delivery_id
     where dm.menu_date = $1 and o.customer_id = $2`, [date, swap.id]);
  const cancelled = await sim.rpc(admin, 'set_subscription_status', [oldSub, 'cancelled', 'Changement d’abonnement']);
  const newSub = await sim.rpc(admin, 'create_subscription_weeks', [swap.id, W.plans.F1, '2026-10-05', 1, null, null, null]);
  await sim.q('select public.refresh_open_default_orders()');
  const mine = await orderOn(wed);
  const onOld = mine.filter((x) => x.subscription_id === oldSub || x.livraison_abo === oldSub).length;
  C('X5', 'changement d\'abonnement : le repas de mercredi suit le nouvel abonnement, plus aucune commande sur l\'ancien',
    '1 commande, rattachée au nouvel abonnement, livraison maintenue', `${mine.length} commande(s), ${onOld} sur l'ancien, livraison ${mine[0] && mine[0].livraison}`,
    cancelled.ok && newSub.ok && mine.length === 1 && onOld === 0 && mine[0].livraison !== 'cancelled' && mine[0].subscription_id === newSub.value, '2026-10-06');
  const live = await sim.rpc(admin, 'orders_live', [wed]);
  const rows = live.ok ? live.value.rows.filter((x) => x.customer_id === swap.id).length : -1;
  const board = await sim.rpc(admin, 'deliveries_board', [wed, wed]);
  const boardRows = board.ok ? board.value.filter((x) => x.customer_id === swap.id).length : -1;
  C('X6', 'le suivi du jour et le tableau de livraison ne montrent le client qu\'une fois', '1 ligne dans chacun', `suivi ${rows}, tableau ${boardRows}`, rows === 1 && boardRows === 1, '2026-10-06');
  const plats7 = await optionsOf(wed, 'plat');
  const accs7 = await optionsOf(wed, 'accompagnement');
  const meat7 = await optionsOf(wed, 'viande');
  const staffEdit = await sim.rpc(admin, 'staff_set_order', [swap.id, wed, plats7[0].id, accs7[0].id, null]);
  const revived = (await sim.one(`select count(*)::int n from public.deliveries where subscription_id = $1 and delivery_date = $2 and status <> 'cancelled'`, [oldSub, wed])).n;
  void meat7;
  C('X7', 'saisie par l\'équipe après un changement d\'abonnement : la livraison de l\'ancien abonnement reste annulée', '0 livraison maintenue sur l\'ancien',
    `${revived} maintenue(s)${staffEdit.ok ? '' : ' (' + staffEdit.msg + ')'}`, revived === 0, '2026-10-06');
  const ov = await sim.as(admin, (d) => d.query(`select amount_remaining::numeric as reste, payment_state from public.subscription_overview where id = $1`, [oldSub]).then((x) => x.rows[0]));
  C('X8', 'abonnement annulé sans paiement : plus de reste à payer, plus dans les impayés', 'reste 0, état « cancelled »', ov.ok ? `reste ${Number(ov.value.reste)}, état ${ov.value.payment_state}` : ov.msg,
    ov.ok && Number(ov.value.reste) === 0 && ov.value.payment_state === 'cancelled', '2026-10-06');

  console.log('\n=== AUDIT DE LA PLANIFICATION ===');
  for (const c of J.cases) console.log(`${c.ok ? 'OK    ' : 'FAILLE'} ${c.id} — ${c.title}\n        attendu : ${c.expected}\n        constaté : ${c.actual}`);
  await db.end();
  process.exit(J.cases.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
