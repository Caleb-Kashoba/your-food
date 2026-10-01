import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

/**
 * Accès des clients : activation du compte (premier mot de passe) ou réinitialisation, avec le code
 * remis par l'administratrice. Fonction publique (le client n'a pas encore de session) : la sécurité
 * repose sur le code à 8 caractères, limité à 10 essais, et à usage unique.
 *
 * Corps : { login, code, password, last4? }
 * Réponse : { ok: true, email } puis le client ouvre sa session avec signInWithPassword(email, password).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface Body {
  login?: string;
  code?: string;
  password?: string;
  last4?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

const MESSAGES: Record<string, string> = {
  not_found: 'Ce nom ne correspond à aucun client.',
  need_last4: 'Plusieurs clients portent ce nom : entre les 4 derniers chiffres de ton numéro.',
  invalid_code: 'Ce code est incorrect ou n’est plus valable. Demande-en un nouveau à l’administratrice.'
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server secrets are not configured' }, 500);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });

  let createdUserId: string | null = null;

  try {
    const body = (await request.json()) as Body;
    const login = body.login?.trim() ?? '';
    const code = body.code?.trim() ?? '';
    const password = body.password ?? '';

    if (!login || !code) return json({ error: 'Entre ton nom et ton code.' }, 400);
    if (password.length < 8) return json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' }, 400);
    if (password.length > 72) return json({ error: 'Le mot de passe est trop long.' }, 400);

    // 1. Vérifier le code (compte les essais, verrouille après 10)
    const { data: verified, error: verifyError } = await service.rpc('verify_customer_access_code', {
      p_login: login,
      p_code: code,
      p_last4: body.last4 ?? null
    });
    if (verifyError) throw verifyError;

    const result = verified as { status: string; customer_id?: string; type?: 'activation' | 'reset' };
    if (result.status !== 'ok' || !result.customer_id) {
      return json({ error: MESSAGES[result.status] ?? MESSAGES.invalid_code, status: result.status }, 400);
    }

    const customerId = result.customer_id;
    const { data: emailData, error: emailError } = await service.rpc('customer_tech_email', {
      p_customer_id: customerId
    });
    if (emailError) throw emailError;
    const email = emailData as string;

    if (result.type === 'reset') {
      // Réinitialisation : le compte existe, on change son mot de passe et on ferme les sessions
      const { data: customer, error: customerError } = await service
        .from('customers')
        .select('auth_user_id')
        .eq('id', customerId)
        .single();
      if (customerError || !customer?.auth_user_id) throw customerError ?? new Error('Compte introuvable');

      const { error: updateError } = await service.auth.admin.updateUserById(customer.auth_user_id, { password });
      if (updateError) throw updateError;
      await service.auth.admin.signOut(customer.auth_user_id, 'global').catch(() => undefined);

      const { error: completeError } = await service.rpc('complete_customer_access', {
        p_customer_id: customerId,
        p_code: code,
        p_auth_user_id: customer.auth_user_id
      });
      if (completeError) throw completeError;
      return json({ ok: true, email, type: 'reset' });
    }

    // Activation : création du compte Auth
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: login, customer_id: customerId }
    });
    if (createError || !created.user) throw createError ?? new Error('Création du compte impossible');
    createdUserId = created.user.id;

    const { error: completeError } = await service.rpc('complete_customer_access', {
      p_customer_id: customerId,
      p_code: code,
      p_auth_user_id: createdUserId
    });
    if (completeError) throw completeError;

    createdUserId = null;
    return json({ ok: true, email, type: 'activation' });
  } catch (error) {
    // Ne laisse pas de compte Auth orphelin si la liaison a échoué
    if (createdUserId) await service.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    console.error('client-access failed', error instanceof Error ? error.message : error);
    return json({ error: 'Une erreur est survenue, réessaie.' }, 500);
  }
});
