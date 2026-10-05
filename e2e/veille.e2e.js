/**
 * Calendrier « la veille » dans un vrai navigateur (projet de PRÉPARATION uniquement) :
 * le client voit et commande le menu de demain ; l'équipe saisit le repas d'un client sans compte.
 * Variables : E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_CLIENT_NAME, E2E_CLIENT_PASSWORD, E2E_NOACCOUNT_NAME (client sans compte).
 */
if (!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD || !process.env.E2E_CLIENT_PASSWORD) {
  console.error('Définir E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD et E2E_CLIENT_PASSWORD (comptes de la préparation).');
  process.exit(2);
}
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = process.env.E2E_BASE || 'http://localhost:4173';
const CLIENT = process.env.E2E_CLIENT_NAME || 'Mireille Kabongo';
const NOACCOUNT = process.env.E2E_NOACCOUNT_NAME || 'Sarah Ilunga';
const SHOTS = process.env.E2E_SHOTS || __dirname;
const results = [];
const field = (page, label) => page.getByText(label, { exact: true }).first().locator('xpath=following-sibling::input[1]');

async function step(name, fn) {
  try { await fn(); results.push(true); console.log('OK   ', name); }
  catch (error) { results.push(false); console.log('ECHEC', name, '→', String(error.message).split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });

  // ─── Client ───
  const client = await (await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'fr-FR' })).newPage();
  client.on('dialog', (d) => d.accept());
  await step('client : connexion', async () => {
    await client.goto(`${BASE}/connexion`);
    await field(client, 'Ton prénom et ton nom').fill(CLIENT);
    await field(client, 'Ton mot de passe').fill(process.env.E2E_CLIENT_PASSWORD);
    await client.getByRole('button', { name: 'Se connecter' }).click();
    await client.getByText(/Au menu demain|Demain,/).first().waitFor({ timeout: 60000 });
  });
  await step('client : le menu proposé est celui de DEMAIN, avec le compte à rebours', async () => {
    const text = await client.locator('body').innerText();
    if (!/Au menu demain, \w+ \d+ \w+/.test(text)) throw new Error('titre : ' + text.slice(0, 120));
    await client.getByRole('timer').waitFor({ timeout: 10000 });
    await client.screenshot({ path: path.join(SHOTS, 'veille-client.png'), fullPage: true });
  });
  await step('client : « Ton repas d’aujourd’hui » (commandé hier) est visible', async () => {
    await client.getByText('Ton repas d’aujourd’hui').waitFor({ timeout: 15000 });
  });
  await step('client : choisir et confirmer le repas de demain', async () => {
    // rejouable : si un essai précédent a annulé le repas, on le reprend d'abord
    const resume = client.getByRole('button', { name: 'Finalement, je mange' });
    if (await resume.isVisible().catch(() => false)) await resume.click();
    for (const category of ['Plat', 'Accompagnement', 'Viande']) {
      const section = client.getByText(category, { exact: true }).first().locator('xpath=ancestor::*[.//*[@role="radio"]][1]');
      await section.getByRole('radio').first().click();
    }
    await client.getByRole('button', { name: /Confirmer mon repas|Modifier mon repas/ }).click();
    await client.getByText('C’est noté, bon appétit !').waitFor({ timeout: 30000 });
  });

  // ─── Équipe ───
  const admin = await (await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'fr-FR' })).newPage();
  await step('équipe : connexion', async () => {
    await admin.goto(`${BASE}/sign-in`);
    await field(admin, 'Adresse e-mail').fill(process.env.E2E_ADMIN_EMAIL);
    await field(admin, 'Mot de passe').fill(process.env.E2E_ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await admin.getByText('Bonjour,', { exact: false }).first().waitFor({ timeout: 60000 });
  });
  await step('équipe : le suivi s’ouvre sur le prochain repas (demain)', async () => {
    await admin.goto(`${BASE}/orders/live`);
    await admin.getByText('(prochain repas)').waitFor({ timeout: 45000 });
  });
  await step('équipe : saisir le repas d’un client sans compte', async () => {
    const card = admin.locator(`xpath=//*[normalize-space(text())="${NOACCOUNT}"]/ancestor::div[.//*[@role="button"][contains(.,"le repas")]][1]`).first();
    await card.getByRole('button', { name: /Saisir le repas|Modifier le repas/ }).first().click();
    await admin.getByText(`Repas de ${NOACCOUNT}`).waitFor({ timeout: 30000 });
    await admin.screenshot({ path: path.join(SHOTS, 'veille-equipe-saisie.png'), fullPage: true });
    for (const title of ['Plat', 'Accompagnement', 'Viande']) {
      await admin.getByText(title, { exact: true }).last().waitFor({ timeout: 15000 });
      const group = admin.getByText(title, { exact: true }).last().locator('xpath=following-sibling::*[1]');
      await group.getByRole('button').first().click();
    }
    await admin.getByRole('button', { name: /Enregistrer/ }).click();
    await admin.getByText(`Repas de ${NOACCOUNT}`).waitFor({ state: 'hidden', timeout: 30000 });
  });
  await step('équipe : le client apparaît comme « a commandé », plus « par défaut »', async () => {
    const row = admin.getByText(NOACCOUNT, { exact: true }).first().locator('xpath=ancestor::*[.//*[contains(text(),"a commandé")]][1]');
    await row.getByText('a commandé').first().waitFor({ timeout: 30000 });
  });

  // ─── Client : annuler demain, puis reprendre ───
  await step('client : annuler le repas de demain', async () => {
    await client.reload();
    await client.getByText(/Au menu demain|Demain,/).first().waitFor({ timeout: 60000 });
    await client.getByRole('button', { name: 'Annuler mon repas' }).click();
    await client.getByRole('button', { name: 'Oui, pas de repas demain' }).click();
    await client.getByText('Repas annulé pour demain.').waitFor({ timeout: 30000 });
  });

  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
