import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  createRealtimeInstanceId,
  createTableRealtimeTopic,
  registerBeforeSubscribe
} from '@/hooks/table-realtime-channel';
import { supabase } from '@/lib/supabase/client';

export function useTableRealtime(table: string, organizationId: string | undefined, queryKeys: readonly (readonly unknown[])[]) {
  const queryClient = useQueryClient();
  const instanceIdRef = useRef<string | null>(null);
  const subscriptionGenerationRef = useRef(0);
  const queryKeysRef = useRef(queryKeys);

  if (instanceIdRef.current === null) instanceIdRef.current = createRealtimeInstanceId();

  useEffect(() => {
    queryKeysRef.current = queryKeys;
  }, [queryKeys]);

  useEffect(() => {
    if (!supabase || !organizationId) return;
    const client = supabase;
    const instanceId = instanceIdRef.current;

    if (!instanceId) return;

    subscriptionGenerationRef.current += 1;
    const topic = createTableRealtimeTopic(
      table,
      organizationId,
      instanceId,
      subscriptionGenerationRef.current
    );
    let channel: ReturnType<typeof client.channel> | undefined;

    try {
      channel = client.channel(topic);
      registerBeforeSubscribe(
        channel,
        (currentChannel) => {
          currentChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table, filter: `organization_id=eq.${organizationId}` },
            () => {
              for (const queryKey of queryKeysRef.current) {
                void queryClient.invalidateQueries({ queryKey });
              }
            }
          );
        },
        (currentChannel) => {
          currentChannel.subscribe((status, error) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn(`[Realtime] ${table} (${organizationId}): ${status}`, error);
            }
          });
        }
      );
    } catch (error) {
      console.warn(`[Realtime] Impossible de souscrire à ${table} (${organizationId}).`, error);
      if (channel) {
        void client.removeChannel(channel).catch((cleanupError) => {
          console.warn(`[Realtime] Impossible de retirer le channel ${topic}.`, cleanupError);
        });
      }
      return;
    }

    return () => {
      void client.removeChannel(channel).catch((error) => {
        console.warn(`[Realtime] Impossible de retirer le channel ${topic}.`, error);
      });
    };
  }, [organizationId, queryClient, table]);
}
