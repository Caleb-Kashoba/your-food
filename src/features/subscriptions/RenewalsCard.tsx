import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/AuthProvider';
import { listSubscriptionsToRenew, renewSubscriptionWeeks, type RenewalItem } from '@/features/subscriptions/subscriptions.service';
import { addLocalDays, formatDayChip, formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const VISIBLE_ROWS = 5;

/** Nouvelle fin après un rallongement d'une semaine */
export function extendedEndDate(endDate: string): string {
  return addLocalDays(endDate, 7);
}

function endLabel(item: RenewalItem): string {
  if (item.daysLeft <= 0) return 'finit aujourd’hui';
  return `finit ${formatDayChip(item.endDate)}`;
}

/**
 * Tableau de bord : abonnements qui se terminent bientôt et n'ont pas de suite.
 * Un client n'a qu'un abonnement en cours : « Rallonger » ajoute une semaine à l'abonnement existant (même formule, prix en plus) ;
 * un deuxième appui confirme, pour éviter un rallongement par erreur.
 */
export function RenewalsCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('subscriptions.write');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sous la clé « dashboard » : le tableau de bord se met à jour avec les abonnements et les livraisons
  const list = useQuery({ queryKey: ['dashboard', 'renewals'], queryFn: listSubscriptionsToRenew });

  const renew = useMutation({
    mutationFn: (customerId: string) => renewSubscriptionWeeks(customerId, 1),
    onSuccess: async () => {
      setConfirming(null);
      setError(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['dashboard'] }), queryClient.invalidateQueries({ queryKey: ['subscriptions'] })]);
    },
    onError: (caught) => {
      setConfirming(null);
      setError(getErrorMessage(caught));
    }
  });

  if (list.error) return <Text style={styles.error}>{getErrorMessage(list.error)}</Text>;
  const items = list.data ?? [];
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, VISIBLE_ROWS);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>À renouveler</Text>
        <View style={styles.count}><Text style={styles.countText}>{items.length}</Text></View>
      </View>
      <Text style={styles.help}>Abonnements qui se terminent bientôt, sans suite. Rallonger ajoute une semaine à l’abonnement existant et lui garde son repas par défaut.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {shown.map((item) => {
        const asking = confirming === item.subscriptionId;
        const newEnd = extendedEndDate(item.endDate);
        return (
          <View key={item.subscriptionId} style={styles.row}>
            <View style={styles.rowTop}>
              <View style={styles.grow}>
                <Text style={styles.name}>{item.customerName}</Text>
                <Text style={styles.meta}>{item.planName} · {endLabel(item)}</Text>
              </View>
              {item.phone ? (
                <Pressable
                  accessibilityLabel={`Écrire à ${item.customerName} sur WhatsApp`}
                  onPress={() => router.push({
                    pathname: '/whatsapp/compose',
                    params: {
                      phone: item.phone!,
                      customerName: item.customerName.split(' ')[0] ?? item.customerName,
                      expirationDate: formatLocalDate(item.endDate),
                      templateCode: 'expiration_reminder'
                    }
                  })}
                  style={styles.whatsapp}
                >
                  <Ionicons color={colors.surface} name="logo-whatsapp" size={20} />
                </Pressable>
              ) : null}
            </View>
            {canWrite ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={renew.isPending}
                  onPress={() => (asking ? renew.mutate(item.customerId) : setConfirming(item.subscriptionId))}
                  style={[styles.renew, asking && styles.renewConfirm]}
                >
                  <Text style={[styles.renewText, asking && styles.renewConfirmText]}>
                    {asking ? (renew.isPending ? 'Rallongement…' : `Confirmer : jusqu’au ${formatDayChip(newEnd)}`) : 'Rallonger 1 semaine'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push({ pathname: '/subscriptions/[id]', params: { id: item.subscriptionId } })}
                >
                  <Text style={styles.link}>Autre durée</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {items.length > VISIBLE_ROWS ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.link}>{expanded ? 'Réduire la liste' : `Afficher les ${items.length - VISIBLE_ROWS} autres`}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { color: colors.primaryDark, fontSize: 17, fontWeight: '900' },
  count: { backgroundColor: colors.warningSoft, borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  countText: { color: colors.warning, fontSize: 13, fontWeight: '900' },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  row: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm, gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  whatsapp: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 19, backgroundColor: '#168C4B' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  renew: { backgroundColor: colors.primarySoft, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  renewConfirm: { backgroundColor: colors.primary },
  renewText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  renewConfirmText: { color: colors.surface },
  link: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 13, fontWeight: '600' }
});
