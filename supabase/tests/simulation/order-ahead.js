'use strict';
/**
 * Commander plusieurs jours à l'avance : fenêtre « jusqu'au vendredi » (par défaut), limite réglable (N jours) ou désactivée,
 * premier jour, fin d'abonnement, verrouillage, modification d'un menu déjà répondu.
 * Chaque cas dit ce qu'on ATTEND ; un cas en échec est une faille.
 *   SIM_DB=fusion_sim node order-ahead.js   (sur une base vierge : setup-db.sh)
 */
const { Client, CFG, Sim, Journal, rng } = require('./lib');
const { seed, PLATS, ACCS, VIANDES } = require('./seed');

(async () => {
  const db = new Client(CFG);
  await db.connect();
  const J = new Journal();
  const sim = new Sim(db, J);
  const W = await seed(sim, rng(55), J);
  const { admin, items, clients } = W;
  const C = (id, title, expected, actual, ok, day) => J.caseResult(id, 'avance', title, expected, actual, ok, day);
  const rejected = (res, re) => !res.ok && (!re || re.test(res.msg));
  const ids = (names) => names.map((n) => items[n].id);
  const names = [...PLATS.slice(0, 3), ...ACCS.slice(0, 2), ...VIANDES.slice(0, 2)];

  const withAccount = clients.filter((c) => c.uid && c.subs[0]);
  const a5 = withAccount.filter((c) => c.group === 'A5' && c.plan === 'F2');
  const grpB = withAccount.filter((c) => c.group === 'B');
  const grpC = withAccount.filter((c) => c.group === 'C');
  const view = (c, date = null) => sim.rpc(c.uid, 'my_today_menu', [date]);
  const week = async (c) => (await sim.rpc(c.uid, 'my_week_menu', [])).value || [];
  const dates = (w) => w.map((d) => d.date).join(', ');
  const menuId = async (date) => (await sim.one('select id from public.daily_menus where menu_date = $1', [date])).id;
  const option = async (date, category, nth = 0) => (await sim.q(
    `select o.id, c.name from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id join public.daily_menus dm on dm.id = o.daily_menu_id
     where dm.menu_date = $1 and c.category = $2 order by c.name asc`, [date, category]))[nth];
  const orderOn = async (c, date, withMeat = true) => sim.rpc(c.uid, 'submit_my_order',
    [await menuId(date), (await option(date, 'plat')).id, (await option(date, 'accompagnement')).id, withMeat ? (await option(date, 'viande')).id : null]);
  const setAhead = (v) => sim.rpc(admin, 'set_order_ahead', [v]);

  // Menus des trois semaines (5, 12 et 19 octobre), publiés le vendredi 2
  await sim.clock('2026-10-02', '12:00:00');
  for (const start of ['2026-10-05', '2026-10-12', '2026-10-19']) {
    const pub = await sim.rpc(admin, 'publish_menus', [start, 5, ids(names), '13:00']);
    if (!pub.ok) throw new Error('publication : ' + pub.msg);
  }

  // ── Lundi 5 octobre : fenêtre par défaut = jusqu'au vendredi 9
  await sim.clock('2026-10-05', '10:00:00');
  const c1 = a5[0];
  const w1 = await week(c1);
  C('A1', 'lundi 5 (limite par défaut : fin de semaine) : le client voit mardi à vendredi', '2026-10-06, 2026-10-07, 2026-10-08, 2026-10-09', dates(w1),
    dates(w1) === '2026-10-06, 2026-10-07, 2026-10-08, 2026-10-09', '2026-10-05');

  const early = await orderOn(c1, '2026-10-08');
  const seen = await view(c1, '2026-10-08');
  C('A2', 'le client choisit le jeudi dès le lundi ; son choix est conservé (pas « par défaut »)', 'accepté, confirmed, non défaut',
    early.ok ? `${seen.value.order && seen.value.order.status}, défaut ${seen.value.order && seen.value.order.is_default}` : early.msg,
    early.ok && seen.ok && seen.value.order && seen.value.order.status === 'confirmed' && seen.value.order.is_default === false, '2026-10-05');

  const farMenu = await menuId('2026-10-12');
  const far = await sim.rpc(c1.uid, 'submit_my_order', [farMenu, (await option('2026-10-12', 'plat')).id, (await option('2026-10-12', 'accompagnement')).id, (await option('2026-10-12', 'viande')).id]);
  const farView = await view(c1, '2026-10-12');
  C('A3', 'la semaine suivante n\'est pas encore ouverte (commande et affichage refusés)', 'deux refus « pas encore ouvert »', `${far.ok ? 'acceptée' : far.msg} / ${farView.ok ? 'affiché' : farView.msg}`,
    rejected(far, /pas encore ouvert/) && rejected(farView, /pas ouvert/), '2026-10-05');

  const today = await orderOn(c1, '2026-10-05');
  const todayView = await view(c1, '2026-10-05');
  C('A4', 'le repas d\'aujourd\'hui ne se commande plus', 'deux refus', `${today.ok ? 'acceptée' : today.msg} / ${todayView.ok ? 'affiché' : todayView.msg}`,
    rejected(today, /plus ouvert/) && rejected(todayView, /pas ouvert/), '2026-10-05');

  // Limite réglable : sans limite, puis 3 jours, puis retour à la semaine
  await setAhead('none');
  const wNone = await week(c1);
  C('A5', 'limite désactivée : tous les menus publiés sont proposés (4 + 5 + 5 jours)', '14 jours, du 6 au 23 octobre',
    `${wNone.length} jours, ${wNone[0] && wNone[0].date} → ${wNone[wNone.length - 1] && wNone[wNone.length - 1].date}`, wNone.length === 14 && wNone[0].date === '2026-10-06' && wNone[13].date === '2026-10-23', '2026-10-05');
  const farNone = await orderOn(c1, '2026-10-14');
  C('A6', 'limite désactivée : le mercredi de la semaine suivante se commande', 'acceptée', farNone.ok ? 'acceptée' : farNone.msg, farNone.ok, '2026-10-05');
  await setAhead('3');
  const w3 = await week(c1);
  C('A7', 'limite de 3 jours : mardi, mercredi, jeudi seulement', '2026-10-06, 2026-10-07, 2026-10-08', dates(w3), dates(w3) === '2026-10-06, 2026-10-07, 2026-10-08', '2026-10-05');
  await setAhead('1');
  const w1d = await week(c1);
  C('A8', 'limite de 1 jour (l\'ancien comportement) : demain seulement', '2026-10-06', dates(w1d), dates(w1d) === '2026-10-06', '2026-10-05');
  const back = await setAhead('week');
  C('A9', 'retour à « week » (valeur par défaut)', 'week', back.ok ? back.value : back.msg, back.ok && back.value === 'week', '2026-10-05');

  const byClient = await sim.rpc(c1.uid, 'set_order_ahead', ['none']);
  const bad = await Promise.all(['0', 'abc', '61', ''].map((v) => setAhead(v)));
  const getv = await sim.rpc(admin, 'get_order_ahead', []);
  C('A10', 'le réglage n\'est modifiable que par l\'équipe, et refuse les valeurs invalides (0, texte, 61, vide)', 'client refusé, 4 refus, valeur « week »',
    `client ${byClient.ok ? 'accepté' : 'refusé'}, ${bad.filter((b) => !b.ok).length} refus, valeur ${getv.ok ? getv.value : getv.msg}`,
    !byClient.ok && bad.every((b) => !b.ok) && getv.ok && getv.value === 'week', '2026-10-05');

  // Modification d'un menu déjà répondu : jamais de perte silencieuse
  const chosenPlat = (await option('2026-10-08', 'plat')).name;
  const allPlats = (await sim.q(
    `select c.id, c.name from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id join public.daily_menus dm on dm.id = o.daily_menu_id
     where dm.menu_date = '2026-10-08' and c.category = 'plat' order by c.name`)).map((x) => x);
  const keepIds = (await sim.q(
    `select c.id from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id join public.daily_menus dm on dm.id = o.daily_menu_id
     where dm.menu_date = '2026-10-08' and c.name <> $1`, [chosenPlat])).map((x) => x.id);
  const removeChosen = await sim.rpc(admin, 'update_menu', ['2026-10-08', keepIds, null]);
  C('A11', 'retirer un plat que des clients ont choisi à l\'avance est refusé, avec le plat et le nombre de clients', `refus citant « ${chosenPlat} (1 client) »`,
    removeChosen.ok ? 'accepté' : removeChosen.msg, rejected(removeChosen, new RegExp(chosenPlat.replace(/[()]/g, '\\$&') + ' \\(1 client\\)')), '2026-10-05');
  const stillThere = await view(c1, '2026-10-08');
  C('A12', 'et le choix du client est intact', 'confirmed', stillThere.ok && stillThere.value.order ? stillThere.value.order.status : 'perdu', stillThere.ok && stillThere.value.order && stillThere.value.order.status === 'confirmed', '2026-10-05');
  const unchosen = allPlats.find((p) => p.name !== chosenPlat);
  const keepWithout = (await sim.q(
    `select c.id from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id join public.daily_menus dm on dm.id = o.daily_menu_id
     where dm.menu_date = '2026-10-08' and c.id <> $1`, [unchosen.id])).map((x) => x.id);
  const removeFree = await sim.rpc(admin, 'update_menu', ['2026-10-08', keepWithout, null]);
  C('A13', 'retirer un plat que personne n\'a choisi (seulement des repas par défaut) reste possible', 'accepté', removeFree.ok ? 'accepté' : removeFree.msg, removeFree.ok, '2026-10-05');
  const noMissing = (await sim.one(
    `select count(*)::int n from public.deliveries dl where dl.delivery_date = '2026-10-08' and dl.status <> 'cancelled'
     and not exists (select 1 from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-08' and o.customer_id = dl.customer_id)`)).n;
  C('A14', 'après ce retrait, tous les clients attendus jeudi ont encore un repas (défauts recalculés)', '0 sans repas', String(noMissing), noMissing === 0, '2026-10-05');
  // On remet le plat pour la suite
  await sim.rpc(admin, 'update_menu', ['2026-10-08', ids(names), null]);

  // ── Mardi 6 : heure limite réglée (20 h) : chaque jour se verrouille à son heure, les autres restent ouverts
  await sim.q(`insert into public.app_settings (organization_id, key, value, is_technical) values ($1, 'order_limit_time', '"20:00"'::jsonb, false)`, [W.org]);
  const c2 = a5[1];
  await sim.clock('2026-10-06', '19:59:59');
  const beforeLimit = await orderOn(c2, '2026-10-07');
  await sim.clock('2026-10-06', '20:00:01');
  const afterLimit = await orderOn(c2, '2026-10-07');
  const thursday = await orderOn(c2, '2026-10-08');
  const wedView = await view(c2, '2026-10-07');
  const thuView = await view(c2, '2026-10-08');
  C('A15', 'heure limite 20 h : le mercredi se commande jusqu\'à mardi 19:59:59, plus après ; le jeudi reste ouvert',
    'acceptée, refusée, acceptée ; mercredi verrouillé, jeudi normal',
    `${beforeLimit.ok ? 'acceptée' : beforeLimit.msg}, ${afterLimit.ok ? 'acceptée' : afterLimit.msg}, ${thursday.ok ? 'acceptée' : thursday.msg} ; ${wedView.value && wedView.value.menu_status}, ${thuView.value && thuView.value.menu_status}`,
    beforeLimit.ok && rejected(afterLimit, /verrouillé/) && thursday.ok && wedView.value.menu_status === 'verrouille' && thuView.value.menu_status === 'normal', '2026-10-06');
  await sim.q(`delete from public.app_settings where organization_id = $1 and key = 'order_limit_time'`, [W.org]);

  // ── Mercredi 7 : dernier jour d'un abonnement qui finit le mercredi
  await sim.clock('2026-10-07', '10:00:00');
  const cb = grpB[0];
  await sim.q(`update public.subscriptions set end_date = '2026-10-07' where id = $1`, [cb.subs[0].id]);
  const tomorrow = await view(cb, '2026-10-08');
  const dayAfter = await view(cb, '2026-10-09');
  const ended = await orderOn(cb, '2026-10-09', cb.plan === 'F2');
  C('A16', 'abonnement fini mercredi : jeudi = « dernier jour » (il court encore aujourd\'hui), vendredi = terminé sans « dernier jour » ; commander vendredi refusé',
    'last_day vrai puis faux ; refus « terminé »',
    `${tomorrow.value && tomorrow.value.last_day}, ${dayAfter.value && dayAfter.value.last_day} ; ${ended.ok ? 'acceptée' : ended.msg}`,
    tomorrow.ok && tomorrow.value.last_day === true && dayAfter.ok && dayAfter.value.last_day === false && rejected(ended, /terminé/), '2026-10-07');

  // ── Jeudi 8, 00:00:30 : le jeudi est verrouillé, le choix pris lundi est conservé et ne se modifie plus
  await sim.clock('2026-10-08', '00:00:30');
  await sim.one('select public.lock_due_menus() as n');
  const locked = await view(c1, '2026-10-08').catch(() => null);
  void locked;
  const afterLock = await sim.one(
    `select o.status, o.is_default from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-08' and o.customer_id = $1`, [c1.id]);
  const lateChange = await orderOn(c1, '2026-10-08');
  C('A17', 'jeudi 00:00:30 : le choix pris lundi est conservé, et on ne peut plus le changer', 'confirmed, non défaut ; changement refusé',
    `${afterLock.status}, défaut ${afterLock.is_default} ; ${lateChange.ok ? 'accepté' : lateChange.msg}`,
    afterLock.status === 'confirmed' && afterLock.is_default === false && !lateChange.ok, '2026-10-08');

  // ── Vendredi 9 : on voit la semaine suivante ; premier jour d'un nouveau client
  await sim.clock('2026-10-09', '12:00:00');
  const w9 = await week(c1);
  C('A18', 'vendredi 9 : demain est un samedi, le client voit la semaine du 12 au 16', '2026-10-12, 2026-10-13, 2026-10-14, 2026-10-15, 2026-10-16', dates(w9),
    dates(w9) === '2026-10-12, 2026-10-13, 2026-10-14, 2026-10-15, 2026-10-16', '2026-10-09');
  const cc = grpC.find((c) => c.plan === 'F2') || grpC[0];
  const firstDay = await view(cc, '2026-10-12');
  const firstOrder = await orderOn(cc, '2026-10-12', cc.plan === 'F2');
  const secondDay = await view(cc, '2026-10-13');
  const secondOrder = await orderOn(cc, '2026-10-13', cc.plan === 'F2');
  C('A19', 'nouveau client qui commence lundi : le lundi lui est attribué d\'office (commande refusée), mais il choisit son mardi',
    'lundi first_day + refus ; mardi pas first_day + accepté',
    `${firstDay.value && firstDay.value.first_day_default}, ${firstOrder.ok ? 'acceptée' : firstOrder.msg} ; ${secondDay.value && secondDay.value.first_day_default}, ${secondOrder.ok ? 'acceptée' : secondOrder.msg}`,
    firstDay.ok && firstDay.value.first_day_default === true && rejected(firstOrder, /premier repas/) && secondDay.ok && secondDay.value.first_day_default === false && secondOrder.ok, '2026-10-09');

  // ── Samedi 10 : même fenêtre
  await sim.clock('2026-10-10', '09:00:00');
  const w10 = await week(c1);
  C('A20', 'samedi 10 : la semaine du 12 au 16', '5 jours, 12 → 16', `${w10.length} jours, ${w10[0] && w10[0].date} → ${w10[w10.length - 1] && w10[w10.length - 1].date}`,
    w10.length === 5 && w10[0].date === '2026-10-12' && w10[4].date === '2026-10-16', '2026-10-10');

  // ── Rien de publié : un seul élément « pas de menu »
  await sim.clock('2026-10-26', '10:00:00');
  const w26 = await week(c1);
  C('A21', 'aucun menu publié : la semaine se réduit à demain, « aucun menu »', '1 élément aucun_menu', `${w26.length} élément(s), ${w26[0] && w26[0].menu_status}`,
    w26.length === 1 && w26[0].menu_status === 'aucun_menu', '2026-10-26');

  console.log('\n=== COMMANDER À L\'AVANCE ===');
  for (const c of J.cases) console.log(`${c.ok ? 'OK    ' : 'FAILLE'} ${c.id} — ${c.title}\n        attendu : ${c.expected}\n        constaté : ${c.actual}`);
  await db.end();
  process.exit(J.cases.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
