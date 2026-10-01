/**
 * Accès des clients, côté administratrice : émettre ou renvoyer un code, réinitialiser un mot de passe,
 * préparer les messages (lien, WhatsApp, QR code). Le code d'activation n'est jamais régénéré tant qu'il n'est pas utilisé.
 */

import { buildAccessLink } from '@/features/client-access/access-link';
import { webBaseUrl } from '@/lib/env';
import { requireSupabase } from '@/lib/supabase/client';

export type AccessCodeType = 'activation' | 'reset';

export interface OpenAccessCode {
  code: string;
  type: AccessCodeType;
  attempts: number;
}

export interface BulkAccessRow {
  customerId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  code: string;
}

/** Code actuellement valable pour un client (null si aucun, ou déjà utilisé) */
export async function getOpenAccessCode(customerId: string): Promise<OpenAccessCode | null> {
  const { data, error } = await requireSupabase()
    .from('customer_access_codes')
    .select('code, type, attempts')
    .eq('customer_id', customerId)
    .is('used_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as OpenAccessCode | null;
}

/** Émet (ou renvoie, pour une activation) le code d'un client */
export async function issueAccessCode(customerId: string, type: AccessCodeType): Promise<string> {
  const { data, error } = await requireSupabase().rpc('issue_customer_access_code', {
    p_customer_id: customerId,
    p_type: type
  });
  if (error) throw error;
  return data as string;
}

/** Codes de tous les clients actifs sans compte (envoi groupé aux clients existants) */
export async function issueMissingAccessCodes(): Promise<BulkAccessRow[]> {
  const { data, error } = await requireSupabase().rpc('issue_missing_access_codes');
  if (error) throw error;
  return (data as { customer_id: string; first_name: string; last_name: string; phone: string | null; code: string }[]).map((row) => ({
    customerId: row.customer_id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    code: row.code
  }));
}

export function accessLinkFor(firstName: string, lastName: string, code: string): string {
  return buildAccessLink(webBaseUrl, code, `${firstName} ${lastName}`);
}

/** Message d'accueil prêt à envoyer par WhatsApp (modifiable avant l'envoi) */
export function buildAccessMessage(params: { firstName: string; link: string; code: string; reset?: boolean }): string {
  const intro = params.reset
    ? `Bonjour ${params.firstName}, voici ton nouveau code pour choisir un nouveau mot de passe Your Food.`
    : `Bonjour ${params.firstName}, ton accès Your Food est prêt : tu peux choisir ton repas chaque jour depuis ton téléphone.`;
  return `${intro}\n\nOuvre ce lien : ${params.link}\nTon code : ${params.code}\n\nÀ très vite à table !`;
}
