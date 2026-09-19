import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';

export function useTableRealtime(table: string, organizationId: string | undefined, queryKeys: readonly (readonly unknown[])[]) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase || !organizationId) return;
    const client = supabase;

    const channel = client
      .channel(`${table}:${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `organization_id=eq.${organizationId}` },
        () => {
          for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [organizationId, queryClient, queryKeys, table]);
}
