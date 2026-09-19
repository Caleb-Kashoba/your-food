import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { listAuditLogs } from '@/features/system/system.service';
import { formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

export default function AuditScreen() {
  const logs = useQuery({ queryKey: ['audit-logs'], queryFn: listAuditLogs });
  if (logs.isLoading) return <LoadingView />;
  if (logs.error) return <ErrorView message={getErrorMessage(logs.error)} onRetry={() => void logs.refetch()} />;

  return (
    <Screen>
      {logs.data?.length === 0 ? <EmptyView message="Les opérations sensibles apparaîtront ici." title="Journal vide" /> : null}
      {logs.data?.map((log) => (
        <View key={log.id} style={styles.log}>
          <View style={styles.header}>
            <Text style={styles.action}>{log.action}</Text>
            <Text style={styles.date}>{formatLocalDate(log.createdAt.slice(0, 10))}</Text>
          </View>
          <Text style={styles.entity}>{log.entityType} · {log.entityId}</Text>
          <Text numberOfLines={3} style={styles.payload}>{JSON.stringify(log.newData ?? log.oldData)}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  log: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  action: { color: colors.primaryDark, fontWeight: '800', textTransform: 'uppercase' },
  date: { color: colors.muted, fontSize: 12 },
  entity: { color: colors.text, fontWeight: '600' },
  payload: { color: colors.muted, fontFamily: 'monospace', fontSize: 11 }
});
