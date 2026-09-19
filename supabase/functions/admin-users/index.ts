import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

type AppRole = 'root' | 'admin' | 'manager' | 'staff';

interface InviteBody {
  action: 'invite';
  email: string;
  displayName: string;
  role: AppRole;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Server secrets are not configured');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const token = authorization.slice('Bearer '.length);
    const { data: authData, error: authError } = await service.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

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
    const { data: permissionRows, error: permissionError } = await service
      .from('role_permissions')
      .select('permissions!inner(code)')
      .eq('role_id', caller.role_id);
    if (permissionError) throw permissionError;
    const permissionCodes = (permissionRows as unknown as Array<{
      permissions: { code: string } | Array<{ code: string }>;
    }>).map((row) => Array.isArray(row.permissions) ? row.permissions[0]?.code : row.permissions.code);
    if (callerRole !== 'root' && !permissionCodes.includes('users.create')) {
      return json({ error: 'Permission denied' }, 403);
    }

    const body = (await request.json()) as InviteBody;
    if (body.action !== 'invite') return json({ error: 'Unsupported action' }, 400);
    if (!body.email?.includes('@') || !body.displayName?.trim()) return json({ error: 'Invalid invitation data' }, 400);
    if (!['root', 'admin', 'manager', 'staff'].includes(body.role)) return json({ error: 'Invalid role' }, 400);
    if (callerRole !== 'root' && (body.role === 'root' || body.role === 'admin')) {
      return json({ error: 'Only a root can invite admin or root users' }, 403);
    }

    const { data: role, error: roleError } = await service
      .from('roles')
      .select('id, hierarchy_level')
      .eq('name', body.role)
      .single();
    if (roleError || !role) throw roleError ?? new Error('Role not found');
    if (callerRole !== 'root' && role.hierarchy_level > (callerRoleRecord?.hierarchy_level ?? 0)) {
      return json({ error: 'Cannot invite a user with a higher role' }, 403);
    }

    const { data: invitation, error: inviteError } = await service.auth.admin.inviteUserByEmail(body.email.trim(), {
      data: { display_name: body.displayName.trim() },
      redirectTo: 'yourfoodadmin://sign-in'
    });
    if (inviteError || !invitation.user) throw inviteError ?? new Error('Invitation failed');

    const { error: profileError } = await service.from('profiles').upsert({
      id: invitation.user.id,
      display_name: body.displayName.trim(),
      email: body.email.trim().toLowerCase()
    });
    if (profileError) throw profileError;

    const { error: membershipError } = await service.from('organization_members').upsert(
      {
        organization_id: caller.organization_id,
        user_id: invitation.user.id,
        role_id: role.id,
        status: 'active'
      },
      { onConflict: 'organization_id,user_id' }
    );
    if (membershipError) throw membershipError;

    return json({ userId: invitation.user.id, invited: true }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return json({ error: message }, 400);
  }
});
