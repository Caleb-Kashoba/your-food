const { chromium } = require('playwright-core');
const path = require('path');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const BASE = 'http://localhost:4173';
const SHOTS = __dirname;
const results = [];
const field = (page, label) => page.getByText(label, { exact: true }).first().locator('xpath=following-sibling::input[1]');

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('OK   ', name);
  } catch (error) {
    results.push({ name, ok: false, error: String(error.message).split('\n')[0] });
    console.log('ECHEC', name, '→', String(error.message).split('\n')[0]);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const adminCtx = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'fr-FR' });
  const admin = await adminCtx.newPage();
  admin.on('pageerror', (e) => console.log('  [admin pageerror]', e.message.split('\n')[0]));

  let mireilleCode = '';
  let marieCode = '';

  // ─── Administratrice : connexion et génération des accès ───
  await step('admin : connexion par e-mail', async () => {
    await admin.goto(`${BASE}/sign-in`);
    await field(admin, 'Adresse e-mail').fill('admin.prepa@yourfood.test');
    await field(admin, 'Mot de passe').fill('Admin@2026!');
    await admin.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await admin.getByText('Bonjour,', { exact: false }).first().waitFor({ timeout: 60000 });
  });

  const openCustomer = async (text) => {
    await admin.goto(`${BASE}/customers`);
    await admin.getByText(text, { exact: false }).first().click();
    await admin.getByText('Accès client', { exact: true }).waitFor({ timeout: 45000 });
  };
  const generateCode = async () => {
    await admin.getByRole('button', { name: /Générer le code d.accès|Régénérer le code/ }).click();
    const code = admin.getByText(/^[A-HJ-NP-Z2-9]{8}$/).first();
    await code.waitFor({ timeout: 45000 });
    return (await code.textContent()).trim();
  };

  await step('admin : code d’accès de Mireille (client existant)', async () => {
    await openCustomer('Mireille Kabongo');
    mireilleCode = await generateCode();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(mireilleCode)) throw new Error('code invalide : ' + mireilleCode);
    await admin.getByRole('button', { name: /Afficher le QR code/ }).click();
    await admin.getByLabel('QR code d’accès').waitFor({ timeout: 40000 });
    await admin.screenshot({ path: path.join(SHOTS, 'admin-acces.png'), fullPage: true });
    const png = PNG.sync.read(await admin.getByLabel('QR code d’accès').screenshot());
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    const expected = BASE + '/bienvenue#acces=' + mireilleCode + '&nom=Mireille%20Kabongo';
    if (!decoded) throw new Error('QR code illisible');
    if (decoded.data !== expected) throw new Error('QR décodé : ' + decoded.data);
  });

  await step('admin : code d’accès de Marie Kabongo n°1 (homonyme, …0005)', async () => {
    await admin.goto(`${BASE}/customers`);
    await admin.getByText('+243811110005', { exact: false }).first().click();
    await admin.getByText('Accès client', { exact: true }).waitFor({ timeout: 45000 });
    marieCode = await generateCode();
  });

  await step('admin : client sans téléphone (Jean) affiché sans plantage', async () => {
    await openCustomer('Jean Tshimanga');
    await admin.getByText('Pas de numéro', { exact: false }).last().waitFor({ timeout: 8000 });
  });

  await step('admin : inscription d’un client sans téléphone, accès généré aussitôt', async () => {
    await admin.goto(BASE + '/customers/new');
    await field(admin, 'Prénom *').fill('Ruth');
    await field(admin, 'Nom *').fill('Ngoy');
    await admin.getByRole('button', { name: 'Créer le client' }).click();
    await admin.getByText('Pas de numéro', { exact: false }).last().waitFor({ timeout: 60000 });
    await admin.getByRole('button', { name: 'Générer le code d’accès' }).click();
    await admin.getByText(/^[A-HJ-NP-Z2-9]{8}$/).first().waitFor({ timeout: 45000 });
    await admin.getByText('Pas de numéro : copie le lien ou montre le QR code au client.').waitFor({ timeout: 5000 });
  });

  await step('admin : abonnement 1 mois = 4 semaines, du lundi au vendredi, 4 × 35 000', async () => {
    await admin.goto(BASE + '/subscriptions/new');
    await admin.getByText('Ruth Ngoy', { exact: false }).first().click();
    await admin.getByText('Formule 2', { exact: false }).first().click();
    await admin.getByRole('button', { name: '1 mois' }).click();
    await admin.getByText('lundi → vendredi', { exact: false }).first().waitFor({ timeout: 8000 });
    const total = await admin.getByText(/^Total :/).first().textContent();
    if (!/140\D?000/.test(total)) throw new Error('total : ' + total);
    await admin.getByRole('button', { name: 'Créer l’abonnement' }).click();
    await admin.waitForTimeout(3000);
    if (admin.url().includes('/subscriptions/new')) throw new Error('toujours sur le formulaire : ' + (await admin.locator('body').innerText()).slice(-300));
  });

  await step('admin : écran « Accès des clients » (envoi groupé)', async () => {
    await admin.goto(BASE + '/customers/access');
    await admin.getByRole('button', { name: 'Préparer les accès' }).click();
    await admin.getByRole('button', { name: 'Préparer les accès' }).last().click();
    await admin.getByText(/client.* à contacter/).waitFor({ timeout: 60000 });
  });

  // ─── Cliente : activation par le lien ───
  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
  const client = await clientCtx.newPage();
  client.on('pageerror', (e) => console.log('  [client pageerror]', e.message.split('\n')[0]));
  const link = `${BASE}/bienvenue#acces=${mireilleCode}&nom=${encodeURIComponent('Mireille Kabongo')}`;

  await step('client : le lien préremplit nom et code, et retire le « # » de l’adresse', async () => {
    await client.goto(link);
    await client.getByText('Bienvenue à table.', { exact: true }).waitFor({ timeout: 60000 });
    const name = await field(client, 'Ton prénom et ton nom').inputValue();
    const code = await field(client, 'Code à 8 caractères').inputValue();
    if (name !== 'Mireille Kabongo') throw new Error('nom : ' + name);
    if (code !== mireilleCode) throw new Error('code : ' + code);
    if (client.url().includes('#')) throw new Error('le fragment reste dans l’adresse : ' + client.url());
    await client.screenshot({ path: path.join(SHOTS, 'client-lien.png') });
  });

  await step('client : mot de passe trop court refusé, puis création du compte', async () => {
    await client.getByRole('button', { name: 'Continuer' }).click();
    await client.getByText('Crée ton mot de passe.', { exact: true }).waitFor({ timeout: 45000 });
    await field(client, 'Au moins 8 caractères').fill('court');
    await field(client, 'Répète le mot de passe').fill('court');
    await client.getByRole('button', { name: 'Créer et entrer' }).click();
    await client.getByText('au moins 8 caractères', { exact: false }).first().waitFor({ timeout: 5000 });
    await field(client, 'Au moins 8 caractères').fill('MireilleSecret1');
    await field(client, 'Répète le mot de passe').fill('MireilleSecret1');
    await client.getByRole('button', { name: 'Créer et entrer' }).click();
    await client.getByText('Au menu', { exact: false }).first().waitFor({ timeout: 60000 });
    await client.screenshot({ path: path.join(SHOTS, 'client-menu.png'), fullPage: true });
  });

  await step('client : le menu du jour affiche 3 catégories et la formule', async () => {
    for (const text of ['Pondu aux crevettes', 'Chikwangue', 'Poisson capitaine braisé', 'Formule 2']) {
      await client.getByText(text, { exact: false }).first().waitFor({ timeout: 40000 });
    }
  });

  await step('client : confirmation bloquée tant que tout n’est pas choisi', async () => {
    const confirm = client.getByRole('button', { name: 'Confirmer mon repas' });
    if (!(await confirm.isDisabled())) throw new Error('le bouton devrait être désactivé');
  });

  await step('client : choix puis confirmation du repas', async () => {
    await client.getByText('Poulet moambe', { exact: true }).click();
    await client.getByText('Fufu de manioc', { exact: true }).click();
    await client.getByText('Poulet grillé', { exact: true }).click();
    await client.getByRole('button', { name: 'Confirmer mon repas' }).click();
    await client.getByText('C’est noté, bon appétit !').waitFor({ timeout: 45000 });
    await client.getByRole('button', { name: 'Repas confirmé' }).waitFor({ timeout: 40000 });
  });

  await step('client : annulation avec confirmation', async () => {
    await client.getByRole('button', { name: 'Annuler mon repas' }).click();
    await client.getByText('Annuler ton repas ?').waitFor({ timeout: 5000 });
    await client.getByRole('button', { name: 'Oui, pas de repas aujourd’hui' }).click();
    await client.getByText('Pas de repas ce jour.').first().waitFor({ timeout: 45000 });
    await client.screenshot({ path: path.join(SHOTS, 'client-annule.png'), fullPage: true });
  });

  await step('client : « Finalement, je mange » puis nouveau choix', async () => {
    await client.getByRole('button', { name: 'Finalement, je mange' }).click();
    await client.getByText('Pondu aux crevettes', { exact: true }).click();
    await client.getByText('Chikwangue', { exact: true }).click();
    await client.getByText('Poisson capitaine braisé', { exact: true }).click();
    await client.getByRole('button', { name: 'Confirmer mon repas' }).click();
    await client.getByText('C’est noté, bon appétit !').waitFor({ timeout: 45000 });
  });

  await step('client : compte (abonnement, solde) et historique vide', async () => {
    await client.getByRole('tab', { name: /Compte/ }).click();
    await client.getByText('Mireille Kabongo').first().waitFor({ timeout: 45000 });
    await client.getByText('Formule 2').first().waitFor({ timeout: 5000 });
    await client.getByText('Reste à payer').first().waitFor({ timeout: 5000 });
    await client.screenshot({ path: path.join(SHOTS, 'client-compte.png'), fullPage: true });
    await client.getByRole('tab', { name: /Historique/ }).click();
    await client.getByText('Rien à afficher').first().waitFor({ timeout: 40000 });
  });

  await step('client : déconnexion puis reconnexion avec « Prénom Nom » + mot de passe', async () => {
    await client.getByRole('tab', { name: /Compte/ }).click();
    await client.getByRole('button', { name: 'Se déconnecter' }).click();
    await client.getByText('Bon retour.', { exact: true }).waitFor({ timeout: 45000 });
    await field(client, 'Ton prénom et ton nom').fill('mireille  KABONGO');
    await field(client, 'Ton mot de passe').fill('mauvais-mot-de-passe');
    await client.getByRole('button', { name: 'Se connecter' }).click();
    await client.getByText('Ce mot de passe ne correspond pas.').waitFor({ timeout: 45000 });
    await field(client, 'Ton mot de passe').fill('MireilleSecret1');
    await client.getByRole('button', { name: 'Se connecter' }).click();
    await client.getByText('Au menu', { exact: false }).first().waitFor({ timeout: 60000 });
  });

  await step('client : un client ne peut pas ouvrir l’espace équipe', async () => {
    await client.goto(`${BASE}/customers`);
    await client.getByText('Au menu', { exact: false }).first().waitFor({ timeout: 60000 });
    if (client.url().includes('/customers')) throw new Error('accès à /customers : ' + client.url());
  });

  // ─── Homonymes ───
  const marieCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
  const marie = await marieCtx.newPage();
  await step('client homonyme : demande les 4 derniers chiffres puis crée son compte', async () => {
    await marie.goto(`${BASE}/premiere-connexion`);
    await field(marie, 'Ton prénom et ton nom').fill('Marie Kabongo');
    await field(marie, 'Code à 8 caractères').fill(marieCode);
    await marie.getByRole('button', { name: 'Continuer' }).click();
    await marie.getByText('Plusieurs clients portent ce nom', { exact: false }).first().waitFor({ timeout: 45000 });
    await field(marie, '4 derniers chiffres de ton numéro').fill('9999');
    await marie.getByRole('button', { name: 'Continuer' }).click();
    await marie.getByText('Ce nom ne correspond à aucun client.').waitFor({ timeout: 45000 });
    await field(marie, '4 derniers chiffres de ton numéro').fill('0005');
    await marie.getByRole('button', { name: 'Continuer' }).click();
    await marie.getByText('Crée ton mot de passe.', { exact: true }).waitFor({ timeout: 45000 });
    await field(marie, 'Au moins 8 caractères').fill('MarieSecret123');
    await field(marie, 'Répète le mot de passe').fill('MarieSecret123');
    await marie.getByRole('button', { name: 'Créer et entrer' }).click();
    await marie.getByText('Au menu', { exact: false }).first().waitFor({ timeout: 60000 });
    // Formule 1 un jeudi : pas de viande
    await marie.getByText('ne comprend pas de viande', { exact: false }).first().waitFor({ timeout: 5000 });
  });

  await step('mauvais code : refusé et compté', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/premiere-connexion`);
    await field(p, 'Ton prénom et ton nom').fill('Jean Tshimanga');
    await field(p, 'Code à 8 caractères').fill('AAAAAAAA');
    await p.getByRole('button', { name: 'Continuer' }).click();
    await p.getByText('Ce code est incorrect', { exact: false }).first().waitFor({ timeout: 45000 });
    await ctx.close();
  });

  // ─── Administratrice : suivi, avis, audit ───
  await step('admin : suivi du jour — Mireille a commandé', async () => {
    await admin.goto(`${BASE}/orders/live`);
    await admin.getByText('Suivi du jour', { exact: true }).first().waitFor({ timeout: 60000 });
    const card = admin.getByText('Mireille Kabongo', { exact: false }).first();
    await card.waitFor({ timeout: 60000 });
    await admin.getByText('a commandé', { exact: true }).first().waitFor({ timeout: 5000 });
    await admin.screenshot({ path: path.join(SHOTS, 'admin-suivi.png'), fullPage: true });
  });

  await step('admin : menus de la semaine', async () => {
    await admin.goto(`${BASE}/menus`);
    await admin.getByText('Menus de la semaine', { exact: true }).waitFor({ timeout: 60000 });
    await admin.getByText('Pondu aux crevettes', { exact: false }).first().waitFor({ timeout: 45000 });
    await admin.screenshot({ path: path.join(SHOTS, 'admin-menus.png'), fullPage: true });
  });

  await step('admin : carte des plats', async () => {
    await admin.goto(`${BASE}/catalog`);
    await admin.getByText('Ta carte, prête à servir.', { exact: true }).waitFor({ timeout: 60000 });
    await admin.getByText('Poulet moambe', { exact: true }).waitFor({ timeout: 45000 });
    // suppression bloquée : plat sur un menu non verrouillé
    await admin.getByLabel('Supprimer Poulet moambe').click();
    await admin.getByRole('button', { name: 'Oui, supprimer' }).click();
    await admin.getByText('Suppression impossible').waitFor({ timeout: 45000 });
    await admin.getByRole('button', { name: 'Fermer' }).or(admin.getByRole('button', { name: 'Désactiver le plat' })).first().waitFor();
  });

  await step('admin : journal d’activité — actions du client avec son nom', async () => {
    await admin.goto(`${BASE}/system/audit`);
    await admin.getByText('Journal d’activité', { exact: true }).waitFor({ timeout: 60000 });
    await admin.getByRole('button', { name: 'Clients', exact: true }).first().click();
    await admin.getByText('Mireille Kabongo', { exact: false }).first().waitFor({ timeout: 60000 });
    await admin.screenshot({ path: path.join(SHOTS, 'admin-audit.png'), fullPage: true });
  });

  await step('admin : statistiques', async () => {
    await admin.goto(`${BASE}/stats`);
    await admin.getByText('Plat le plus commandé', { exact: true }).waitFor({ timeout: 60000 });
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} étapes réussies`);
  require('fs').writeFileSync(path.join(SHOTS, 'e2e-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
