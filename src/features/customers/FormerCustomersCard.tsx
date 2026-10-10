import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useAuth } from '@/features/auth/AuthProvider';
import { inactivityText } from '@/features/customers/customer-status';
import { decideFormerCustomer, listFormerProposals, type FormerProposal } from '@/features/customers/customers.service';
import { formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

export const FORMER_PROPOSALS_KEY = ['customers', 'former-proposals'] as const;

/** Nombre de clients à confirmer (pastille de l'onglet Clients) ; 0 sans droit d'écriture sur les clients */
export function useFormerProposals() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('customers.write');
  return useQuery({ queryKey: FORMER_PROPOSALS_KEY, queryFn: listFormerProposals, enabled: allowed, refetchInterval: 5 * 60_000 });
}

/**
 * Tableau de bord : clients inactifs depuis un mois, à confirmer comme « anciens clients ».
 * « Pas encore » garde le client inactif et repousse la prochaine proposition de 2 semaines.
 */
export function FormerCustomersCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const proposals = useFormerProposals();
  const [asking, setAsking] = useState<FormerProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideFormerCustomer(id, approve),
    onSuccess: async () => {
      setError(null);
      setAsking(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FORMER_PROPOSALS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
    },
    onError: (failure) => {
      setAsking(null);
      setError(getErrorMessage(failure));
    }
  });

  const list = proposals.data ?? [];
  if (list.length === 0) return null;
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>À confirmer : anciens clients</Text>
      <Text style={styles.meta}>
        Ces clients n’ont plus d’abonnement depuis un mois. Si tu réponds « Pas encore », la question reviendra dans 2 semaines.
      </Text>
      {list.map((item) => (
        <View key={item.customerId} style={styles.row}>
          <Text onPress={() => router.push({ pathname: '/customers/[id]', params: { id: item.customerId } })} style={styles.name}>
            {item.customerName}
          </Text>
          <Text style={styles.meta}>
            Inactif depuis {inactivityText(item.inactiveDays)} (abonnement fini le {formatLocalDate(item.lastEnd)})
            {item.refusals > 0 ? ` · déjà reporté ${item.refusals} fois` : ''}
          </Text>
          <View style={styles.actions}>
            <AppButton disabled={decide.isPending} label="Ancien client" onPress={() => setAsking(item)} style={styles.grow} />
            <AppButton
              disabled={decide.isPending}
              label="Pas encore"
              onPress={() => decide.mutate({ id: item.customerId, approve: false })}
              style={styles.grow}
              variant="secondary"
            />
          </View>
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Confirmer"
        loading={decide.isPending}
        message="Il reste dans la liste des clients (filtre « Anciens clients ») et redevient actif dès qu’il a un nouvel abonnement."
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && decide.mutate({ id: asking.customerId, approve: true })}
        title={asking ? `${asking.customerName} devient un ancien client ?` : ''}
        visible={asking !== null}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  title: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  row: { gap: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  error: { color: colors.danger, fontSize: 13, fontWeight: '700' }
});
