'use strict';
/**
 * Heure limite de commande réglable : aucune (minuit), la veille à HH:MM, ou le jour J à HH:MM (midi au plus tard).
 * Chaque cas dit ce qu'on ATTEND ; un cas en échec est une faille.
 *   SIM_DB=fusion_sim node order-limit.js   (sur une base vierge : setup-db.sh)
 */
const { Client, CFG, Sim, Journal, rng } = require('./lib');
const { seed, PLATS, ACCS, VIANDES } = require('./seed');

(async () => {
  const db = new Client(CFG);
  await db.connect();
  const J = new Journal();
  const sim = new Sim(db, J);
  const W = await seed(sim, rng(66), J);
  const { admin, items, clients } = W;
  const C = (id, title, expected, actual, ok, day) => J.caseResult(id, 'limite', title, expected, actual, ok, day);
  const rejected = (res, re) => !res.ok && (!re || re.test(res.msg));
  const ids = (names) => names.map((n) => items[n].id);
  const names = [...PLATS.slice(0, 3), ...ACCS.slice(0, 2), ...VIANDES.slice(0, 2)];

  const withAccount = clients.filter((c) => c.uid && c.subs[0]);
  const a5 = withAccount.filter((c) => c.group === 'A5' && c.plan === 'F2');
  const grpC = withAccount.filter((c) => c.group === 'C');
  const view = (c, date = null) => sim.rpc(c.uid, 'my_today_menu', [date]);
  const week = async (c) => (await sim.rpc(c.uid, 'my_week_menu', [])).value || [];
  const dates = (w) => w.map((d) => d.date).join(', ');
  const menuId = async (date) => (await sim.one('select id from public.daily_menus where menu_date = $1', [date])).id;
  const option = async (date, category) => (await sim.q(
    `select o.id from public.menu_options o join public.catalog_items c on c.id = o.catalog_item_id join public.daily_menus dm on dm.id = o.daily_menu_id
     where dm.menu_date = $1 and c.category = $2 order by c.name asc`, [date, category]))[0];
  const orderOn = async (c, date, withMeat = true) => sim.rpc(c.uid, 'submit_my_order',
    [await menuId(date), (await option(date, 'plat')).id, (await option(date, 'accompagnement')).id, withMeat ? (await option(date, 'viande')).id : null]);
  const setLimit = (v) => sim.rpc(admin, 'set_order_limit', [v]);
  const getLimit = async () => (await sim.rpc(admin, 'get_order_limit', [])).value;
  const numbered = async (date) => (await sim.one(`select count(*) filter (where bowl_number is not null)::int n from public.deliveries where delivery_date = $1 and status <> 'cancelled'`, [date])).n;

  await sim.clock('2026-10-02', '12:00:00');
  for (const start of ['2026-10-05', '2026-10-12', '2026-10-19']) {
    const pub = await sim.rpc(admin, 'publish_menus', [start, 5, ids(names), '13:00']);
    if (!pub.ok) throw new Error('publication : ' + pub.msg);
  }

  // ── Par défaut : aucune limite, verrouillage à minuit
  await sim.clock('2026-10-06', '10:00:00');
  const c1 = a5[0];
  const w0 = await week(c1);
  const today0 = await orderOn(c1, '2026-10-06');
  C('L1', 'sans limite (par défaut) : le jour J n\'est pas proposé ni commandable, valeur « none »', 'mercredi à vendredi ; refus ; none',
    `${dates(w0)} ; ${today0.ok ? 'acceptée' : today0.msg} ; ${await getLimit()}`,
    dates(w0) === '2026-10-07, 2026-10-08, 2026-10-09' && rejected(today0, /verrouillé/) && (await getLimit()) === 'none', '2026-10-06');

  // ── La veille à 20 h
  const s1 = await setLimit('veille@20:00');
  const c2 = a5[1];
  await sim.clock('2026-10-06', '19:59:59');
  const okBefore = await orderOn(c2, '2026-10-07');
  await sim.clock('2026-10-06', '20:00:01');
  const koAfter = await orderOn(c2, '2026-10-07');
  const thu = await orderOn(c2, '2026-10-08');
  const wedView = await view(c2, '2026-10-07');
  C('L2', 'la veille à 20:00 : mercredi se commande jusqu\'à mardi 19:59:59, pas après ; jeudi reste ouvert ; échéance annoncée au client',
    'acceptée, refusée, acceptée ; échéance mardi 6 à 20:00',
    `${okBefore.ok ? 'acceptée' : okBefore.msg}, ${koAfter.ok ? 'acceptée' : koAfter.msg}, ${thu.ok ? 'acceptée' : thu.msg} ; ${wedView.value && wedView.value.menu.lock_date} ${wedView.value && wedView.value.menu.lock_time}`,
    s1.ok && s1.value === 'veille@20:00' && okBefore.ok && rejected(koAfter, /verrouillé/) && thu.ok && wedView.value.menu.lock_date === '2026-10-06' && /^20:00/.test(wedView.value.menu.lock_time), '2026-10-06');

  // ── Le jour J à 6 h
  const s2 = await setLimit('jour@06:00');
  await sim.clock('2026-10-08', '05:00:00');
  const c3 = a5[2];
  const wJ = await week(c3);
  const beforeNum = await numbered('2026-10-08');
  const todayView = await view(c3, '2026-10-08');
  await sim.clock('2026-10-08', '05:59:59');
  const orderJ = await orderOn(c3, '2026-10-08');
  const changeJ = await orderOn(c3, '2026-10-08');
  C('L3', 'le jour J à 06:00, à 05:00 : le jour même est proposé en premier, encore ouvert, échéance « aujourd\'hui à 06:00 » ; commande et modification acceptées jusqu\'à 05:59:59',
    'jeudi, vendredi ; normal ; échéance jeudi 8 ; acceptées',
    `${dates(wJ)} ; ${todayView.value && todayView.value.menu_status} ; ${todayView.value && todayView.value.menu.lock_date} ; ${orderJ.ok ? 'acceptée' : orderJ.msg} / ${changeJ.ok ? 'acceptée' : changeJ.msg}`,
    s2.ok && dates(wJ) === '2026-10-08, 2026-10-09' && todayView.ok && todayView.value.menu_status === 'normal' && todayView.value.menu.lock_date === '2026-10-08' && orderJ.ok && changeJ.ok, '2026-10-08');
  C('L4', 'avant l\'heure, les bols ne sont pas encore numérotés (le menu est ouvert)', '0 bol numéroté', String(beforeNum), beforeNum === 0, '2026-10-08');

  await sim.clock('2026-10-08', '06:00:01');
  const late = await orderOn(c3, '2026-10-08');
  const wAfter = await week(c3);
  C('L5', 'à 06:00:01 : le jour J est fermé (« verrouillé ») et n\'est plus proposé ; demain l\'est toujours', 'refus ; vendredi',
    `${late.ok ? 'acceptée' : late.msg} ; ${dates(wAfter)}`, rejected(late, /verrouillé/) && dates(wAfter) === '2026-10-09', '2026-10-08');
  await sim.clock('2026-10-08', '06:00:30');
  await sim.one('select public.lock_due_menus() as n');
  const afterNum = await numbered('2026-10-08');
  const kept = await sim.one(`select o.status, o.is_default from public.meal_orders o join public.daily_menus dm on dm.id = o.daily_menu_id where dm.menu_date = '2026-10-08' and o.customer_id = $1`, [c3.id]);
  C('L6', 'au verrouillage de 06:00 : les bols sont numérotés et le choix du client est conservé', 'bols numérotés > 0 ; confirmed, non défaut',
    `${afterNum} bols ; ${kept.status}, défaut ${kept.is_default}`, afterNum > 0 && kept.status === 'confirmed' && kept.is_default === false, '2026-10-08');

  // ── Validation du réglage : midi au plus tard le jour J
  const ok12 = await setLimit('jour@12:00');
  const ko1201 = await setLimit('jour@12:01');
  const bad = await Promise.all(['jour@25:00', 'veille@9:00', 'abc', 'jour@', ''].map((v) => setLimit(v)));
  const byClient = await sim.rpc(c1.uid, 'set_order_limit', ['none']);
  const upper = await setLimit('VEILLE@21:30');
  C('L7', 'jour J : 12:00 accepté, 12:01 refusé (« midi au plus tard ») ; formats invalides et client refusés ; casse normalisée', 'ok, refus, 5 refus, client refusé, veille@21:30',
    `${ok12.ok ? ok12.value : ok12.msg}, ${ko1201.ok ? 'accepté' : ko1201.msg}, ${bad.filter((b) => !b.ok).length} refus, ${byClient.ok ? 'client accepté' : 'client refusé'}, ${upper.ok ? upper.value : upper.msg}`,
    ok12.ok && ok12.value === 'jour@12:00' && rejected(ko1201, /midi/) && bad.every((b) => !b.ok) && !byClient.ok && upper.ok && upper.value === 'veille@21:30', '2026-10-07');

  // ── Désactiver : « none » remet le verrouillage à minuit
  await setLimit('none');
  await sim.clock('2026-10-09', '10:00:00');
  const wNone = await week(c1);
  C('L8', 'désactivée (« none ») : retour au verrouillage à minuit, le jour J n\'est plus proposé', '12 → 16', dates(wNone), dates(wNone) === '2026-10-12, 2026-10-13, 2026-10-14, 2026-10-15, 2026-10-16', '2026-10-09');

  // ── Ancien réglage `order_limit_time` : lu comme « la veille » tant que `order_limit` est vide
  await sim.q(`delete from public.app_settings where organization_id = $1 and key = 'order_limit'`, [W.org]);
  await sim.q(`insert into public.app_settings (organization_id, key, value, is_technical) values ($1, 'order_limit_time', '"20:00"'::jsonb, false)`, [W.org]);
  const legacy = await getLimit();
  await setLimit('none');
  const overridden = await getLimit();
  await sim.q(`delete from public.app_settings where organization_id = $1 and key = 'order_limit_time'`, [W.org]);
  C('L9', 'ancien réglage « 20:00 » lu comme « la veille à 20:00 » ; « none » explicite le désactive', 'veille@20:00 puis none', `${legacy} puis ${overridden}`, legacy === 'veille@20:00' && overridden === 'none', '2026-10-08');

  // ── Premier jour d'un nouveau client, le jour J : attribué d'office
  await setLimit('jour@06:00');
  await sim.clock('2026-10-12', '05:00:00');
  const cc = grpC.find((c) => c.plan === 'F2') || grpC[0];
  const fd = await view(cc, '2026-10-12');
  const fo = await orderOn(cc, '2026-10-12', cc.plan === 'F2');
  C('L10', 'le jour J, nouveau client dont l\'abonnement commence ce jour : repas attribué d\'office, commande refusée', 'first_day_default ; refus « premier repas »',
    `${fd.value && fd.value.first_day_default} ; ${fo.ok ? 'acceptée' : fo.msg}`, fd.ok && fd.value.first_day_default === true && rejected(fo, /premier repas/), '2026-10-12');

  // ── Vendredi : le jour J (vendredi) puis la semaine suivante
  await sim.clock('2026-10-16', '05:00:00');
  const wFri = await week(c1);
  C('L11', 'vendredi 05:00 avec « jour@06:00 » : vendredi lui-même puis la semaine du 12 au 16', '2026-10-16 puis 19 → 23', dates(wFri),
    dates(wFri) === '2026-10-16, 2026-10-19, 2026-10-20, 2026-10-21, 2026-10-22, 2026-10-23', '2026-10-16');

  console.log('\n=== HEURE LIMITE DE COMMANDE ===');
  for (const c of J.cases) console.log(`${c.ok ? 'OK    ' : 'FAILLE'} ${c.id} — ${c.title}\n        attendu : ${c.expected}\n        constaté : ${c.actual}`);
  await db.end();
  process.exit(J.cases.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
