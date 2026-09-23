import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import {
  canInviteRole,
  getInvitationRedirect,
  normalizeCongolesePhone,
  type AppRole,
  type InvitationChannel
} from './policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const allowedRoles: AppRole[] = ['root', 'admin', 'manager', 'staff'];
const allowedChannels: InvitationChannel[] = ['email', 'whatsapp'];

interface InviteBody {
  action: 'invite';
  email: string;
  displayName: string;
  whatsapp?: string | null;
  role: AppRole;
  channel: InvitationChannel;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function getInvitationExpiry() {
  const configuredSeconds = Number(Deno.env.get('INVITE_LINK_EXPIRY_SECONDS') ?? '3600');
  const seconds = Number.isFinite(configuredSeconds)
    ? Math.min(Math.max(Math.trunc(configuredSeconds), 60), 86_400)
    : 3600;

  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let createdUserId: string | null = null;
  let service: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Server secrets are not configured');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

    service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    const token = authorization.slice('Bearer '.length);
    const { data: authData, error: authError } = await service.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

    const body = (await request.json()) as InviteBody;
    const email = body.email?.trim().toLowerCase();
    const displayName = body.displayName?.trim();

    if (body.action !== 'invite') return json({ error: 'Unsupported action' }, 400);
    if (!email || !isEmail(email) || !displayName) return json({ error: 'Invalid invitation data' }, 400);
    if (!allowedRoles.includes(body.role)) return json({ error: 'Invalid role' }, 400);
    if (!allowedChannels.includes(body.channel)) return json({ error: 'Invalid invitation channel' }, 400);

    const normalizedWhatsApp = normalizeCongolesePhone(body.whatsapp);
    if (body.whatsapp?.trim() && !normalizedWhatsApp) {
      return json({ error: 'Invalid WhatsApp number' }, 400);
    }
    if (body.channel === 'whatsapp' && !normalizedWhatsApp) {
      return json({ error: 'A WhatsApp number is required for this channel' }, 400);
    }

    const { data: caller, error: callerError } = await service
      .from('organization_members')
      .select('id, organization_id, role_id, status, roles!inner(name, hierarchy_level)')
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .single();
    if (callerError || !caller) return json({ error: 'Active membership required' }, 403);

    const callerRoleRelation = caller.roles as unknown as
      | { name: AppRole; hierarchy_level: number }
      | Array<{ name: AppRole; hierarchy_level: number }>;
    const callerRoleRecord = Array.isArray(callerRoleRelation) ? callerRoleRelation[0] : callerRoleRelation;
    const callerRole = callerRoleRecord?.name;
    if (!callerRole) return json({ error: 'Caller role not found' }, 403);

    const { data: permissionRows, error: permissionError } = await service
      .from('role_permissions')
      .select('permissions!inner(code)')
      .eq('role_id', caller.role_id);
    if (permissionError) throw permissionError;
    const permissionCodes = (permissionRows as unknown as Array<{
      permissions: { code: string } | Array<{ code: string }>;
    }>).map((row) => Array.isArray(row.permissions) ? row.permissions[0]?.code : row.permissions.code);

    if (!canInviteRole(callerRole, body.role, permissionCodes.includes('users.create'))) {
      const error = body.role === 'root' || body.role === 'admin'
        ? 'Only a root can invite admin or root users'
        : 'Permission denied';
      return json({ error }, 403);
    }

    await service.rpc('expire_internal_user_invitations');

    const { data: existingProfile, error: existingProfileError } = await service
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;
    if (existingProfile) {
      const { data: existingMemberships, error: membershipsError } = await service
        .from('organization_members')
        .select('id, organization_id, status')
        .eq('user_id', existingProfile.id);
      if (membershipsError) throw membershipsError;

      const { data: previousInvitations, error: invitationsError } = await service
        .from('internal_user_invitations')
        .select('id, organization_id, status')
        .eq('invited_user_id', existingProfile.id)
        .order('created_at', { ascending: false });
      if (invitationsError) throw invitationsError;

      const hasActiveMembership = (existingMemberships ?? []).some((membership) => membership.status === 'active');
      const belongsToAnotherOrganization = (existingMemberships ?? []).some(
        (membership) => membership.organization_id !== caller.organization_id
      );
      const hasAcceptedInvitation = (previousInvitations ?? []).some((invitation) => invitation.status === 'accepted');
      const hasInvitationHistory = (previousInvitations ?? []).length > 0;

      if (hasActiveMembership || belongsToAnotherOrganization || hasAcceptedInvitation || !hasInvitationHistory) {
        return json(
          { error: 'Un compte existe déjà avec cette adresse e-mail. Réactivez le compte existant au lieu de créer une nouvelle invitation.' },
          409
        );
      }

      const now = new Date().toISOString();
      const { error: cancelError } = await service
        .from('internal_user_invitations')
        .update({ status: 'cancelled', cancelled_at: now })
        .eq('organization_id', caller.organization_id)
        .eq('invited_user_id', existingProfile.id)
        .eq('status', 'pending');
      if (cancelError) throw cancelError;

      const { error: deleteError } = await service.auth.admin.deleteUser(existingProfile.id);
      if (deleteError) throw deleteError;
    }

    const metadata = {
      display_name: displayName,
      whatsapp: normalizedWhatsApp,
      requested_role: body.role,
      invitation_channel: body.channel
    };
    const redirectTo = getInvitationRedirect(body.channel, Deno.env.get('INVITE_WEB_REDIRECT_URL'));
    let inviteLink: string | undefined;
    let invitedUserId: string;

    if (body.channel === 'email') {
      const { data: invitation, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
        data: metadata,
        redirectTo
      });
      if (inviteError || !invitation.user) throw inviteError ?? new Error('Invitation failed');
      invitedUserId = invitation.user.id;
    } else {
      const { data: invitation, error: inviteError } = await service.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: metadata, redirectTo }
      });
      if (inviteError || !invitation.user || !invitation.properties?.action_link) {
        throw inviteError ?? new Error('Invitation link generation failed');
      }
      invitedUserId = invitation.user.id;
      inviteLink = invitation.properties.action_link;
    }
    createdUserId = invitedUserId;

    const expiresAt = getInvitationExpiry();
    const { data: invitationId, error: registrationError } = await service.rpc(
      'register_internal_user_invitation',
      {
        p_actor_user_id: authData.user.id,
        p_invited_user_id: invitedUserId,
        p_email: email,
        p_display_name: displayName,
        p_whatsapp: normalizedWhatsApp,
        p_requested_role: body.role,
        p_channel: body.channel,
        p_expires_at: expiresAt
      }
    );
    if (registrationError || !invitationId) {
      throw registrationError ?? new Error('Invitation registration failed');
    }

    createdUserId = null;
    return json(
      {
        invitationId,
        userId: invitedUserId,
        channel: body.channel,
        status: 'pending',
        expiresAt,
        ...(inviteLink ? { inviteLink } : {})
      },
      201
    );
  } catch (error) {
    if (createdUserId && service) {
      await service.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return json({ error: message }, 400);
  }
});
