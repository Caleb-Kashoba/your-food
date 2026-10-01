const { chromium } = require('playwright-core');
const BASE = 'http://localhost:4173';
const field = (page, label) => page.getByText(label, { exact: true }).first().locator('xpath=following-sibling::input[1]');
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log('OK   ', name); }
  catch (e) { results.push(false); console.log('ECHEC', name, '→', String(e.message).split('\n')[0]); }
}
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 400, height: 900 }, locale: 'fr-FR' })).newPage();
  await page.goto(`${BASE}/sign-in`);
  await field(page, 'Adresse e-mail').fill('admin.prepa@yourfood.test');
  await field(page, 'Mot de passe').fill('Admin@2026!');
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await page.getByText('Bonjour,', { exact: false }).first().waitFor({ timeout: 60000 });
  await page.goto(`${BASE}/today`);
  await page.getByText('Total à préparer').first().waitFor({ timeout: 60000 });

  await step('Préparation : le repas de chaque client est affiché (plat + accompagnement + viande)', async () => {
    await page.getByRole('button', { name: 'Tous' }).click();
    await page.getByText('Poisson capitaine braisé').first().waitFor({ timeout: 20000 });
    await page.getByText('Sarah Ilunga').first().waitFor({ timeout: 20000 });
  });

  await step('Préparation : « Marquer comme prêt » puis retour arrière', async () => {
    await page.getByRole('button', { name: 'À préparer', exact: true }).click();
    const before = await page.getByRole('button', { name: 'Marquer comme prêt' }).count();
    if (before === 0) throw new Error('aucun bol à préparer');
    await page.getByRole('button', { name: 'Marquer comme prêt' }).first().click();
    await page.waitForFunction((n) => document.querySelectorAll('[role=button]').length >= 0 && true, before);
    await page.waitForTimeout(2500);
    const after = await page.getByRole('button', { name: 'Marquer comme prêt' }).count();
    if (after !== before - 1) throw new Error(`avant ${before}, après ${after}`);
    await page.getByRole('button', { name: 'Prêts' }).click();
    await page.getByRole('button', { name: 'Remettre à préparer' }).first().click();
    await page.waitForTimeout(2500);
  });

  await step('Livraison : seuls les bols prêts sont à livrer ; livrer puis annuler', async () => {
    await page.getByRole('button', { name: 'Livraison' }).click();
    await page.getByRole('button', { name: /À livrer · \d/ }).click();
    const n = await page.getByRole('button', { name: 'Marquer comme livré' }).count();
    if (n < 1) throw new Error('aucun repas prêt');
    await page.getByRole('button', { name: 'Marquer comme livré' }).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Livrés · \d/ }).click();
    await page.locator('xpath=//*[contains(text(),"Sarah Ilunga")]/ancestor::div[.//*[@role="button"][contains(.,"Annuler la livraison")]][1]').getByRole('button', { name: 'Annuler la livraison' }).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /À livrer · \d/ }).click();
    const back = await page.getByRole('button', { name: 'Marquer comme livré' }).count();
    if (back !== n) throw new Error(`avant ${n}, après ${back}`);
  });

  await step('Livraison : un bol « pas encore prêt » ne peut pas être livré', async () => {
    await page.getByRole('button', { name: /Pas encore prêts/ }).click();
    await page.getByText('Pas encore prêt : à préparer d’abord.').first().waitFor({ timeout: 10000 });
    if ((await page.getByRole('button', { name: 'Marquer comme livré' }).count()) !== 0) throw new Error('bouton de livraison présent');
  });

  await step('7 jours : on change de jour et on voit les clients', async () => {
    await page.getByRole('button', { name: 'Préparation' }).click();
    await page.getByRole('button', { name: /^ven\./ }).first().click();
    await page.getByText('Vendredi 2 octobre').first().waitFor({ timeout: 10000 });
  });
  await browser.close();
  console.log(results.filter(Boolean).length + '/' + results.length);
})();
