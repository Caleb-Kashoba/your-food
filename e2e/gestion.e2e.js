/**
 * Parcours navigateur de gestion (projet de PRÉPARATION uniquement) : carte, abonnement (suspension, prix, paiement), formule.
 * Utilise le client de test « Jean Tshimanga » et son abonnement. Modifie des données de test.
 */
if (!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD) { console.error('Définir E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD (compte administratrice de la préparation).'); process.exit(2); }
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE || 'http://localhost:4173';
const results = [];
const field = (page, label) => page.getByText(label, { exact: true }).first().locator('xpath=following-sibling::input[1]');
const area = (page, label) => page.getByText(label, { exact: true }).first().locator('xpath=following-sibling::*[self::textarea or self::input][1]');

async function step(name, fn) {
  try { await fn(); results.push(true); console.log('OK   ', name); }
  catch (error) { results.push(false); console.log('ECHEC', name, '→', String(error.message).split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'fr-FR' })).newPage();
  const dialogs = [];
  let accept = true;
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); if (accept) await dialog.accept(); else await dialog.dismiss(); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.split('\n')[0]));
  const lastDialog = () => dialogs[dialogs.length - 1] || '';

  await step('connexion de l’administratrice', async () => {
    await page.goto(`${BASE}/sign-in`);
    await field(page, 'Adresse e-mail').fill(process.env.E2E_ADMIN_EMAIL);
    await field(page, 'Mot de passe').fill(process.env.E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await page.getByText('Bonjour,', { exact: false }).first().waitFor({ timeout: 60000 });
  });

  // ─── Carte ───
  const dish = 'Plat essai navigateur';
  await step('carte : ajouter un plat', async () => {
    await page.goto(`${BASE}/catalog`);
    await field(page, 'Nouveau plat').fill(dish);
    await page.getByRole('button', { name: 'Ajouter à la carte' }).click();
    await page.getByText('Plat ajouté à la carte.').waitFor({ timeout: 30000 });
    await page.getByText(dish, { exact: true }).first().waitFor({ timeout: 15000 });
  });
  await step('carte : renommer le plat', async () => {
    await page.getByLabel(`Modifier ${dish}`).click();
    const input = field(page, 'Nom du plat');
    await input.fill(`${dish} (v2)`);
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByText(`${dish} (v2)`, { exact: true }).first().waitFor({ timeout: 30000 });
  });
  await step('carte : désactiver puis réactiver', async () => {
    await page.getByLabel(`Proposer ${dish} (v2)`).click();
    await page.getByText('désactivé', { exact: true }).first().waitFor({ timeout: 30000 });
    await page.getByLabel(`Proposer ${dish} (v2)`).click();
    await page.waitForFunction(() => !document.body.innerText.includes('désactivé'), null, { timeout: 30000 });
  });
  await step('carte : plat vide refusé (bouton désactivé)', async () => {
    await field(page, 'Nouveau plat').fill('   ');
    if (!(await page.getByRole('button', { name: 'Ajouter à la carte' }).isDisabled())) throw new Error('bouton actif avec un nom vide');
  });
  await step('carte : supprimer le plat jamais servi', async () => {
    await page.getByLabel(`Supprimer ${dish} (v2)`).click();
    await page.getByRole('button', { name: 'Oui, supprimer' }).click();
    await page.getByText(/Plat supprimé/).waitFor({ timeout: 30000 });
    await page.waitForFunction((t) => !document.body.innerText.includes(t), `${dish} (v2)`, { timeout: 15000 });
  });

  // ─── Abonnement ───
  await step('abonnement : ouvrir celui de Jean Tshimanga', async () => {
    await page.goto(`${BASE}/subscriptions`);
    await page.getByText('Jean Tshimanga', { exact: false }).first().click();
    await page.getByText('Gestion contrôlée').waitFor({ timeout: 45000 });
  });
  await step('abonnement : suspendre sans motif est refusé', async () => {
    const before = dialogs.length;
    await page.getByRole('button', { name: 'Suspendre' }).click();
    await page.waitForFunction((n) => true, before);
    await page.waitForTimeout(800);
    if (!/Motif requis/.test(dialogs.slice(before).join(' '))) throw new Error('message : ' + dialogs.slice(before).join(' | '));
  });
  await step('abonnement : suspendre avec motif puis réactiver', async () => {
    await area(page, 'Motif de suspension ou d’annulation').fill('Voyage');
    await page.getByRole('button', { name: 'Suspendre' }).click();
    await page.getByText('suspended', { exact: true }).first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Réactiver' }).click();
    await page.getByText('active', { exact: true }).first().waitFor({ timeout: 30000 });
  });
  await step('abonnement : annulation refusée si l’on décline la confirmation', async () => {
    accept = false;
    await area(page, 'Motif de suspension ou d’annulation').fill('Test de refus');
    await page.getByRole('button', { name: 'Annuler l’abonnement' }).click();
    await page.waitForTimeout(800);
    accept = true;
    if ((await page.getByText('cancelled', { exact: true }).count()) !== 0) throw new Error('annulé malgré le refus');
  });
  await step('abonnement : prix exceptionnel (raison obligatoire)', async () => {
    const button = page.getByRole('button', { name: 'Modifier le prix' });
    const shown = await page.getByText(/^Prix actuel : /).first().textContent();
    const current = Number(shown.split('FC')[0].replace(/\D/g, ''));
    const target = current + 1000;
    await field(page, 'Nouveau prix total').fill(String(target));
    if (!(await button.isDisabled())) throw new Error('bouton actif sans raison');
    await field(page, 'Raison du changement').fill('Tarif négocié');
    await button.click();
    await page.waitForFunction((n) => document.body.innerText.replace(/\D/g, '').includes(String(n)) && /Prix actuel/.test(document.body.innerText)
      && new RegExp('Prix actuel : ' + String(n).replace(/(\d)(?=(\d{3})+$)/g, '$1\\D?')).test(document.body.innerText), target, { timeout: 30000 });
  });
  const paymentRef = 'E2E-' + Date.now();
  await step('paiement : partiel accepté, dépassement refusé', async () => {
    await page.getByRole('button', { name: 'Enregistrer un paiement' }).click();
    await page.getByText('Montant versé', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByText('Espèces', { exact: true }).click();
    await field(page, 'Montant versé').fill('500000');
    const before = dialogs.length;
    await page.getByRole('button', { name: 'Confirmer le paiement' }).click();
    await page.waitForTimeout(3000);
    if (page.url().includes('/payments/new') === false) throw new Error('dépassement accepté (page quittée)');
    if (dialogs.length === before) throw new Error('aucun message de refus');
    if (/Informations incomplètes/.test(lastDialog())) throw new Error('refus pour une autre raison : ' + lastDialog());
    await field(page, 'Montant versé').fill('1000');
    await field(page, 'Référence').fill(paymentRef);
    await page.getByRole('button', { name: 'Confirmer le paiement' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/payments/new'), { timeout: 30000 });
  });
  await step('abonnement : le paiement apparaît et le restant diminue', async () => {
    await page.goto(`${BASE}/subscriptions`);
    await page.getByText('Jean Tshimanga', { exact: false }).first().click();
    await page.getByText('Restant', { exact: true }).waitFor({ timeout: 45000 });
    await page.getByText(paymentRef, { exact: false }).first().waitFor({ timeout: 15000 });
  });

  // ─── Formule ───
  await step('formule : jours de viande — deux au maximum', async () => {
    await page.goto(`${BASE}/plans`);
    await page.getByText('Formule 1', { exact: false }).first().click();
    await page.getByText('Nom de la formule', { exact: true }).waitFor({ timeout: 45000 });
    await page.getByText('jours au maximum', { exact: false }).first().waitFor({ timeout: 10000 });
  });

  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
