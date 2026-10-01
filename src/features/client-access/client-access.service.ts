/**
 * Connexion et activation des clients : identifiant « Prénom Nom » (+ 4 derniers chiffres du téléphone en cas
 * d'homonyme), code remis par l'administratrice, puis mot de passe. Le compte Auth sous-jacent utilise un
 * e-mail technique que le client ne voit jamais.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { normalizeAccessCode } from '@/features/client-access/access-link';
import { requireSupabase } from '@/lib/supabase/client';

export type AccessErrorKind = 'need_last4' | 'not_found' | 'invalid_code' | 'not_activated' | 'bad_password' | 'other';

export class AccessError extends Error {
  constructor(message: string, readonly kind: AccessErrorKind) {
    super(message);
    this.name = 'AccessError';
  }
}

interface ResolveResult {
  status: 'ok' | 'not_found' | 'need_last4';
  customer_id?: string;
  first_name?: string;
  activated?: boolean;
  email?: string;
}

const NOT_FOUND = 'Ce nom ne correspond à aucun client.';
const NEED_LAST4 = 'Plusieurs clients portent ce nom : entre les 4 derniers chiffres de ton numéro.';

async function resolveLogin(login: string, last4?: string): Promise<ResolveResult> {
  const { data, error } = await requireSupabase().rpc('resolve_customer_login', {
    p_login: login,
    p_last4: last4?.trim() || null
  });
  if (error) throw new AccessError('Connexion impossible. Vérifie ton réseau et réessaie.', 'other');
  return data as ResolveResult;
}

export async function signInClient(params: { login: string; password: string; last4?: string }): Promise<void> {
  const resolved = await resolveLogin(params.login, params.last4);
  if (resolved.status === 'need_last4') throw new AccessError(NEED_LAST4, 'need_last4');
  if (resolved.status !== 'ok' || !resolved.email) throw new AccessError(NOT_FOUND, 'not_found');
  if (!resolved.activated) {
    throw new AccessError('Ton compte n’est pas encore activé : utilise ton code de première connexion.', 'not_activated');
  }

  const { error } = await requireSupabase().auth.signInWithPassword({ email: resolved.email, password: params.password });
  if (error) throw new AccessError('Ce mot de passe ne correspond pas.', 'bad_password');
}

/** Étape 1 : vérifie le code sans le consommer ; retourne le prénom et le type (activation ou réinitialisation) */
export async function verifyAccessCode(params: {
  login: string;
  code: string;
  last4?: string;
}): Promise<{ firstName: string; type: 'activation' | 'reset' }> {
  const { data, error } = await requireSupabase().rpc('verify_customer_access_code', {
    p_login: params.login,
    p_code: normalizeAccessCode(params.code),
    p_last4: params.last4?.trim() || null
  });
  if (error) throw new AccessError('Connexion impossible. Vérifie ton réseau et réessaie.', 'other');

  const result = data as { status: string; first_name?: string; type?: 'activation' | 'reset' };
  if (result.status === 'need_last4') throw new AccessError(NEED_LAST4, 'need_last4');
  if (result.status === 'not_found') throw new AccessError(NOT_FOUND, 'not_found');
  if (result.status !== 'ok' || !result.type) {
    throw new AccessError('Ce code est incorrect ou n’est plus valable. Demande-en un nouveau à l’administratrice.', 'invalid_code');
  }
  return { firstName: result.first_name ?? '', type: result.type };
}

/** Étape 2 : consomme le code, crée (ou change) le mot de passe, puis ouvre la session */
export async function activateAccount(params: {
  login: string;
  code: string;
  password: string;
  last4?: string;
}): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<{ ok: boolean; email: string }>('client-access', {
    body: { login: params.login, code: normalizeAccessCode(params.code), password: params.password, last4: params.last4 ?? null }
  });

  if (error) {
    let message = 'Une erreur est survenue, réessaie.';
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string; status?: string } | null;
      if (body?.error) message = body.error;
      if (body?.status === 'invalid_code') throw new AccessError(message, 'invalid_code');
    }
    throw new AccessError(message, 'other');
  }
  if (!data?.ok || !data.email) throw new AccessError('Une erreur est survenue, réessaie.', 'other');

  const { error: signInError } = await client.auth.signInWithPassword({ email: data.email, password: params.password });
  if (signInError) throw new AccessError('Compte créé, mais la connexion a échoué : réessaie de te connecter.', 'other');
}
