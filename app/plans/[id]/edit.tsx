import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { getPlan, updatePlan } from '@/features/plans/plans.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';
import type { Plan } from '@/types/domain';

const days = [
  { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' }, { value: 5, label: 'Ven' }, { value: 6, label: 'Sam' }, { value: 7, label: 'Dim' }
];

export default function EditPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = useQuery({ queryKey: ['plan', id], queryFn: () => getPlan(id), enabled: Boolean(id) });

  if (plan.isLoading) return <LoadingView />;
  if (plan.error || !plan.data) return <ErrorView message={getErrorMessage(plan.error)} onRetry={() => void plan.refetch()} />;

  return <EditPlanForm plan={plan.data} />;
}

function EditPlanForm({ plan }: { plan: Plan }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [price, setPrice] = useState(String(plan.price));
  const [durationValue, setDurationValue] = useState(String(plan.durationValue));
  const [durationUnit, setDurationUnit] = useState<'day' | 'week' | 'month'>(plan.durationUnit);
  const [weekdays, setWeekdays] = useState<number[]>(plan.serviceWeekdays);
  const [isActive, setIsActive] = useState(plan.isActive);
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: number) => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort());
  const save = async () => {
    const numericPrice = Number(price.replace(/\s/g, ''));
    const numericDuration = Number(durationValue);
    if (!name.trim() || numericPrice <= 0 || numericDuration <= 0 || weekdays.length === 0) {
      Alert.alert('Informations incomplètes', 'Renseignez le nom, le prix, la durée et au moins un jour de service.');
      return;
    }
    try {
      setSaving(true);
      await updatePlan(plan.id, {
        name: name.trim(),
        description: description.trim() || null,
        price: numericPrice,
        currency: plan.currency,
        durationValue: numericDuration,
        durationUnit,
        weekdays
      }, isActive);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plans'] }),
        queryClient.invalidateQueries({ queryKey: ['plan', plan.id] })
      ]);
      router.back();
    } catch (error) {
      Alert.alert('Modification impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <AppInput label="Nom de la formule" onChangeText={setName} value={name} />
      <AppInput label="Description" multiline onChangeText={setDescription} value={description} />
      <AppInput keyboardType="numeric" label={`Prix (${plan.currency})`} onChangeText={setPrice} value={price} />
      <AppInput keyboardType="number-pad" label="Durée" onChangeText={setDurationValue} value={durationValue} />
      <View style={styles.units}>
        {(['day', 'week', 'month'] as const).map((unit) => (
          <Pressable key={unit} onPress={() => setDurationUnit(unit)} style={[styles.unit, durationUnit === unit && styles.active]}>
            <Text style={[styles.unitText, durationUnit === unit && styles.activeText]}>{unit === 'day' ? 'Jour(s)' : unit === 'week' ? 'Semaine(s)' : 'Mois'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Jours de service</Text>
      <View style={styles.days}>
        {days.map((day) => (
          <Pressable key={day.value} onPress={() => toggleDay(day.value)} style={[styles.day, weekdays.includes(day.value) && styles.active]}>
            <Text style={[styles.unitText, weekdays.includes(day.value) && styles.activeText]}>{day.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setIsActive((value) => !value)} style={[styles.status, isActive && styles.statusActive]}>
        <Text style={[styles.unitText, isActive && styles.activeText]}>{isActive ? 'Formule active' : 'Formule inactive'}</Text>
      </Pressable>
      <Text style={styles.note}>Les abonnements existants conservent leur tarif et leurs jours de service historiques.</Text>
      <AppButton label="Enregistrer les modifications" loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  units: { flexDirection: 'row', gap: spacing.sm },
  unit: { flex: 1, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md },
  unitText: { color: colors.muted, fontWeight: '700' },
  active: { backgroundColor: colors.primary, borderColor: colors.primary },
  activeText: { color: colors.surface },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  day: { borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  status: { alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  statusActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 }
});
