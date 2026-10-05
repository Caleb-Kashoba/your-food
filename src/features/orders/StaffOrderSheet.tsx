import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { getStaffOrderContext, staffCancelOrder, staffSetOrder, type StaffOrderContext } from '@/features/orders/orders.service';
import { capitalizeFirst, formatDayMonth } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, shadows, spacing } from '@/theme/colors';

interface Props {
  customerId: string;
  customerName: string;
  date: string;
  onClose: () => void;
}

type Category = 'plat' | 'accompagnement' | 'viande';
const TITLE: Record<Category, string> = { plat: 'Plat', accompagnement: 'Accompagnement', viande: 'Viande' };

/** L'administratrice ou le manager choisit, modifie ou annule le repas d'un client (jusqu'à ce que le bol soit prêt) */
export function StaffOrderSheet({ customerId, customerName, date, onClose }: Props) {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ['orders', 'staff-context', customerId, date], queryFn: () => getStaffOrderContext(customerId, date) });
  const [picks, setPicks] = useState<Partial<Record<Category, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const data = context.data;
  const saved: Partial<Record<Category, string | null>> =
    data?.order && data.order.status === 'confirmed'
      ? { plat: data.order.plat_option_id, accompagnement: data.order.accompagnement_option_id, viande: data.order.viande_option_id }
      : {};
  const value = (category: Category): string | null => picks[category] ?? saved[category] ?? null;
  const required: Category[] = data?.meat_allowed ? ['plat', 'accompagnement', 'viande'] : ['plat', 'accompagnement'];
  const complete = required.every((category) => value(category) !== null);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      staffSetOrder({
        customerId,
        date,
        plat: value('plat')!,
        accompagnement: value('accompagnement')!,
        viande: data?.meat_allowed ? value('viande') : null
      }),
    onSuccess: done,
    onError: (caught) => setError(getErrorMessage(caught))
  });
  const cancel = useMutation({
    mutationFn: () => staffCancelOrder(customerId, date),
    onSuccess: done,
    onError: (caught) => setError(getErrorMessage(caught))
  });

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Repas de {customerName}</Text>
              <Text style={styles.subtitle}>{capitalizeFirst(formatDayMonth(date))}</Text>
            </View>
            <Pressable accessibilityLabel="Fermer" accessibilityRole="button" onPress={onClose}>
              <Ionicons color={colors.muted} name="close" size={26} />
            </Pressable>
          </View>

          {context.isLoading ? <Text style={styles.note}>Chargement…</Text> : null}
          {context.error ? <Text style={styles.error}>{getErrorMessage(context.error)}</Text> : null}

          {data ? (
            <Body
              data={data}
              onPick={(category, id) => {
                setError(null);
                setPicks({ ...picks, [category]: id });
              }}
              value={value}
            />
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {data?.editable ? (
            <View style={styles.actions}>
              <AppButton
                disabled={!complete}
                label={data.order?.status === 'confirmed' && !data.order.is_default ? 'Enregistrer la modification' : 'Enregistrer ce repas'}
                loading={save.isPending}
                onPress={() => save.mutate()}
              />
              <AppButton label="Annuler le repas de ce client" loading={cancel.isPending} onPress={() => cancel.mutate()} variant="ghost" />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Body({ data, value, onPick }: { data: StaffOrderContext; value: (category: Category) => string | null; onPick: (category: Category, id: string) => void }) {
  if (!data.editable) return <Text style={styles.note}>{data.reason ?? 'La saisie n’est pas possible.'}</Text>;
  const categories: Category[] = data.meat_allowed ? ['plat', 'accompagnement', 'viande'] : ['plat', 'accompagnement'];
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {data.menu_locked ? <Text style={styles.note}>Le menu est verrouillé : la saisie reste possible tant que le bol n’est pas prêt.</Text> : null}
      {data.order?.status === 'cancelled' ? <Text style={styles.note}>Ce client a annulé ce repas : l’enregistrer le rétablit.</Text> : null}
      {data.order?.is_default ? <Text style={styles.note}>Repas actuellement choisi par défaut.</Text> : null}
      {categories.map((category) => (
        <ChipGroup
          key={category}
          onChange={(id) => id && onPick(category, id)}
          options={data.options.filter((option) => option.category === category).map((option) => ({ value: option.option_id, label: option.name }))}
          title={TITLE[category]}
          value={value(category)}
        />
      ))}
      {!data.meat_allowed ? <Text style={styles.note}>La formule de ce client n’inclut pas de viande ce jour-là.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(53, 23, 14, 0.45)' },
  sheet: { alignSelf: 'center', width: '100%', maxWidth: 560, maxHeight: '88%', backgroundColor: colors.surfaceStrong, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, gap: spacing.md, ...shadows.raised },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headerText: { flex: 1 },
  title: { color: colors.primaryDark, fontSize: 21, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  body: { gap: spacing.lg, paddingBottom: spacing.sm },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  actions: { gap: spacing.xs }
});
