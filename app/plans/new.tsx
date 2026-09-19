import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { createPlan } from '@/features/plans/plans.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const days = [
  { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' }, { value: 5, label: 'Ven' }, { value: 6, label: 'Sam' }, { value: 7, label: 'Dim' }
];

export default function NewPlanScreen() {
  const { member } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [durationValue, setDurationValue] = useState('1');
  const [durationUnit, setDurationUnit] = useState<'week' | 'month'>('week');
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6]);
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: number) => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort());
  const save = async () => {
    const numericPrice = Number(price.replace(/\s/g, ''));
    const numericDuration = Number(durationValue);
    if (!member || !name.trim() || numericPrice <= 0 || numericDuration <= 0 || weekdays.length === 0) {
      Alert.alert('Informations incomplètes', 'Renseignez le nom, le prix, la durée et au moins un jour de service.');
      return;
    }
    try {
      setSaving(true);
      await createPlan(member.organizationId, {
        name: name.trim(),
        description: description.trim() || null,
        price: numericPrice,
        currency: 'CDF',
        durationValue: numericDuration,
        durationUnit,
        weekdays
      });
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      router.back();
    } catch (error) {
      Alert.alert('Création impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <AppInput label="Nom de la formule" onChangeText={setName} value={name} />
      <AppInput label="Description" multiline onChangeText={setDescription} value={description} />
      <AppInput keyboardType="numeric" label="Prix (CDF)" onChangeText={setPrice} value={price} />
      <AppInput keyboardType="number-pad" label="Durée" onChangeText={setDurationValue} value={durationValue} />
      <View style={styles.units}>
        {(['week', 'month'] as const).map((unit) => (
          <Pressable key={unit} onPress={() => setDurationUnit(unit)} style={[styles.unit, durationUnit === unit && styles.active]}>
            <Text style={[styles.unitText, durationUnit === unit && styles.activeText]}>{unit === 'week' ? 'Semaine(s)' : 'Mois'}</Text>
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
      <AppButton label="Créer la formule" loading={saving} onPress={() => void save()} />
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
  day: { borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }
});
