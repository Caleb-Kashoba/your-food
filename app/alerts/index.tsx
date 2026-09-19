import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { listAlerts, updateAlertStatus } from '@/features/alerts/alerts.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';
import type { AlertStatus } from '@/types/domain';

export default function AlertsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: listAlerts });
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AlertStatus }) => updateAlertStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (error) => Alert.alert('Action impossible', getErrorMessage(error))
  });

  if (alerts.isLoading) return <LoadingView />;
  if (alerts.error) return <ErrorView message={getErrorMessage(alerts.error)} onRetry={() => void alerts.refetch()} />;

  return (
    <Screen>
      {alerts.data?.length === 0 ? <EmptyView message="Les rappels d’expiration apparaîtront ici." title="Aucune alerte" /> : null}
      {alerts.data?.map((item) => (
        <View key={item.id} style={styles.alert}>
          <View style={styles.header}>
            <View style={styles.grow}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
            <StatusBadge status={item.status} />
          </View>
          {item.status === 'unread' ? (
            <View style={styles.actions}>
              {item.whatsapp ? (
                <Pressable
                  onPress={() => router.push({
                    pathname: '/whatsapp/compose',
                    params: {
                      phone: item.whatsapp!,
                      customerName: item.customerName ?? '',
                      expirationDate: item.triggerDate,
                      templateCode: 'expiration_reminder'
                    }
                  })}
                  style={styles.primaryAction}
                >
                  <Text style={styles.primaryText}>WhatsApp</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => mutation.mutate({ id: item.id, status: 'handled' })} style={styles.secondaryAction}><Text style={styles.secondaryText}>Traiter</Text></Pressable>
              <Pressable onPress={() => mutation.mutate({ id: item.id, status: 'ignored' })} style={styles.ghostAction}><Text style={styles.ghostText}>Ignorer</Text></Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  alert: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryAction: { backgroundColor: '#168C4B', borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  primaryText: { color: colors.surface, fontWeight: '700' },
  secondaryAction: { backgroundColor: colors.primarySoft, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  secondaryText: { color: colors.primaryDark, fontWeight: '700' },
  ghostAction: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  ghostText: { color: colors.muted, fontWeight: '700' }
});
