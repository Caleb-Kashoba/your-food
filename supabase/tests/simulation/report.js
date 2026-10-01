'use strict';
/**
 * Génère l'annexe détaillée (Markdown) à partir de sim-results.json (et des mut-*.json s'ils existent).
 *   node report.js <sim-results.json> <sortie.md> [dossier-des-mutations]
 */
const fs = require('fs');
const path = require('path');

const [, , input, output, mutDir] = process.argv;
if (!input || !output) { console.error('usage : node report.js <sim-results.json> <sortie.md> [dossier-mutations]'); process.exit(2); }
const R = JSON.parse(fs.readFileSync(input, 'utf8'));
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const nf = (n) => Number(n).toLocaleString('fr-FR');
const lines = [];
const out = (s = '') => lines.push(s);

out('# Annexe — simulation d\'un mois : résultats détaillés');
out();
out(`> Générée par \`supabase/tests/simulation/report.js\` à partir de \`sim-results.json\` (${R.generated_at}). Base locale reconstruite depuis les migrations, graine aléatoire ${R.seed} (rejouable à l'identique).`);
out();

// 1. Synthèse
const okCases = R.cases.filter((c) => c.ok).length;
out('## 1. Synthèse');
out();
out('| | |');
out('|---|---|');
out(`| Période simulée | ${R.start} → ${R.end} (${R.days.length} jours, ${R.days.filter((d) => d.menu).length} jours avec menu) |`);
out(`| Clients | ${R.clients} (groupes : ${Object.entries(R.groups).map(([k, v]) => `${k} ${v}`).join(', ')}) |`);
out(`| Profils de comportement (clients avec compte) | ${Object.entries(R.personas).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
out(`| Cas de test nommés | **${okCases} / ${R.cases.length} conformes** (${new Set(R.cases.map((c) => c.id)).size} identifiants distincts) |`);
out(`| Invariants violés | **${R.violations.length}** |`);
out(`| Commandes en base | ${nf(R.totals.commandes)} dont ${nf(R.totals.defauts)} repas par défaut et ${nf(R.totals.annulees)} annulées |`);
out(`| Livraisons | ${nf(R.totals.livraisons)} dont ${nf(R.totals.livrees)} livrées |`);
out(`| Avis, alertes, lignes de journal | ${nf(R.totals.avis)}, ${nf(R.totals.alertes)}, ${nf(R.totals.audit)} |`);
out();

// 2. Actions jouées
out('## 2. Volume d\'actions jouées');
out();
out('| Action | Nombre |');
out('|---|---:|');
const labels = {
  lectures_menu: 'Menus du jour ouverts par des clients', commandes_acceptees: 'Commandes acceptées', commandes_refusees: 'Commandes refusées (toutes attendues par le modèle)',
  annulations_acceptees: 'Annulations acceptées', annulations_refusees: 'Annulations refusées (toutes attendues)', attaques: 'Tentatives interdites de clients (toutes refusées)',
  repas_par_defaut: 'Repas par défaut attribués au verrouillage', bols_prepares: 'Bols préparés', livraisons_livrees: 'Livraisons livrées', livraisons_echouees: 'Livraisons échouées',
  avis_acceptes: 'Avis déposés', alertes_creees: 'Alertes d\'expiration créées', controles_rls: 'Contrôles d\'isolation (un client ne voit que ses données)', commande_sans_menu: 'Clients arrivés un jour sans menu'
};
for (const [k, v] of Object.entries(R.counters)) out(`| ${labels[k] || k} | ${nf(v)} |`);
out();

// 3. Cas par domaine
out('## 3. Cas nommés, par domaine');
out();
const byArea = {};
for (const c of R.cases) (byArea[c.area] ||= []).push(c);
for (const [area, list] of Object.entries(byArea)) {
  out(`### ${area[0].toUpperCase()}${area.slice(1)} (${list.filter((c) => c.ok).length}/${list.length})`);
  out();
  out('| Id | Jour | Cas | Attendu | Constaté | |');
  out('|---|---|---|---|---|:-:|');
  for (const c of list) out(`| ${c.id} | ${c.day || ''} | ${esc(c.title)} | ${esc(c.expected)} | ${esc(c.actual)} | ${c.ok ? '✅' : '❌'} |`);
  out();
}

// 4. Calendrier
out('## 4. Calendrier du mois');
out();
out('| Jour | | Menu | Votes | Par défaut | Annulés | Livrés / attendus | Durée de la journée simulée |');
out('|---|---|:-:|---:|---:|---:|---:|---:|');
for (const d of R.days) out(`| ${d.day} | ${d.dow} | ${d.menu ? 'oui' : '—'} | ${d.voted} | ${d.defaults} | ${d.cancelled} | ${d.delivered} / ${d.expected} | ${d.ms} ms |`);
out();

// 5. Invariants
out('## 5. Invariants contrôlés chaque soir après le verrouillage');
out();
out('| Invariant | Énoncé | Violations |');
out('|---|---|---:|');
const INV = [
  ['I1', 'Toute livraison non annulée a exactement une commande après 20 h'],
  ['I2', 'Une annulation du client annule la livraison, et inversement'],
  ['I3', 'La viande suit la formule (jours de viande en vigueur ce jour-là)'],
  ['I4', 'Une commande annulée n\'a aucun choix et n\'est pas « par défaut »'],
  ['I5', 'Les options d\'une commande appartiennent au menu du jour'],
  ['I6', 'Les repas par défaut = option la plus choisie de chaque catégorie (égalité : ordre alphabétique), nombre exact'],
  ['I7', 'Un menu verrouillé ne change plus'],
  ['I8', 'Les paiements confirmés ne dépassent jamais le prix de l\'abonnement'],
  ['RLS', 'Un client ne voit que sa fiche, ses abonnements, livraisons, commandes, paiements ; un anonyme ne voit rien'],
  ['état', 'L\'état d\'abonnement et « viande aujourd\'hui » affichés au client = recalcul indépendant sur les dates']
];
for (const [id, text] of INV) {
  const n = R.violations.filter((v) => v.rule.startsWith(id === 'état' ? 'etat_abonnement' : id)).length + (id === 'état' ? R.violations.filter((v) => v.rule === 'viande_jour').length : 0);
  out(`| ${id} | ${text} | ${n} |`);
}
out();
if (R.violations.length) {
  out('### Violations relevées');
  out();
  out('| Règle | Jour | Détail |');
  out('|---|---|---|');
  for (const v of R.violations.slice(0, 80)) out(`| ${v.rule} | ${v.day} | ${esc(v.detail)} |`);
  out();
}

// 6. Performance
out('## 6. Rapidité (≈ 100 clients, base locale — hors réseau)');
out();
out('| Opération | Appels | Médiane | 95e centile | Max |');
out('|---|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(R.perf)) out(`| ${k} | ${v.n} | ${v.median} ms | ${v.p95} ms | ${v.max} ms |`);
out();
out('Ces durées sont celles de la base seule ; sur Supabase, ajouter la latence réseau (≈ 100 à 400 ms par appel observés depuis cette machine).');
out();

// 7. Essais de sensibilité
if (mutDir && fs.existsSync(mutDir)) {
  const files = fs.readdirSync(mutDir).filter((f) => /^mut-.*\.json$/.test(f)).sort();
  if (files.length) {
    out('## 7. La simulation sait-elle détecter une panne ? (essais de sensibilité)');
    out();
    out('Une règle est cassée volontairement dans la base locale, puis tout le mois est rejoué : la simulation doit alors échouer.');
    out();
    out('| Panne injectée | Détectée | Cas en échec | Invariants violés |');
    out('|---|:-:|---|---|');
    for (const f of files) {
      const m = JSON.parse(fs.readFileSync(path.join(mutDir, f), 'utf8'));
      const ko = m.cases.filter((c) => !c.ok).map((c) => c.id);
      const rules = {};
      for (const v of m.violations) rules[v.rule] = (rules[v.rule] || 0) + 1;
      const detected = ko.length + m.violations.length > 0;
      out(`| ${f.replace(/^mut-|\.json$/g, '')} | ${detected ? '✅' : '❌'} | ${ko.join(', ') || '—'} | ${Object.entries(rules).map(([k, v]) => `${k} ×${v}`).join(', ') || '—'} |`);
    }
    out();
  }
}

fs.writeFileSync(output, lines.join('\n') + '\n');
console.log('Annexe écrite :', output, `(${lines.length} lignes)`);
