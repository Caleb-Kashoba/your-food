/**
 * Lien d'accès d'un client : le code et le nom sont placés après le « # » de l'adresse, qui n'est jamais
 * envoyée au serveur. Le paramètre s'appelle « acces » (et non « code ») pour ne jamais être pris pour
 * un code d'authentification Supabase par `parseAuthLink`.
 */

export interface AccessLinkData {
  code: string;
  name: string;
}

/** Code à 8 caractères, sans 0, 1, I ni O (même alphabet que la base) */
const ACCESS_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeAccessCode(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase();
}

export function isCompleteAccessCode(raw: string): boolean {
  return ACCESS_CODE_PATTERN.test(normalizeAccessCode(raw));
}

export function buildAccessLink(baseUrl: string, code: string, name: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/bienvenue#acces=${normalizeAccessCode(code)}&nom=${encodeURIComponent(name.trim())}`;
}

export function parseAccessLink(url: string): AccessLinkData | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return null;

  const parameters = new URLSearchParams(url.slice(hashIndex + 1));
  const code = normalizeAccessCode(parameters.get('acces') ?? '');
  if (!isCompleteAccessCode(code)) return null;

  return { code, name: (parameters.get('nom') ?? '').trim() };
}

// Mémoire de la page : le lien est lu une fois, puis retiré de la barre d'adresse
let pending: AccessLinkData | null = null;

export function setPendingAccess(data: AccessLinkData | null): void {
  pending = data;
}

export function takePendingAccess(): AccessLinkData | null {
  const data = pending;
  pending = null;
  return data;
}
