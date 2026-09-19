import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import {
  customerSchema,
  type CustomerFormValues,
  type CustomerPayload
} from '@/features/customers/customer.schema';
import { listDeliveryZones } from '@/features/customers/customers.service';
import { colors, radii, spacing } from '@/theme/colors';

interface CustomerFormProps {
  initialValues?: Partial<CustomerFormValues>;
  onSubmit: (values: CustomerPayload) => Promise<void>;
  submitLabel: string;
}

const defaults: CustomerFormValues = {
  firstName: '',
  lastName: '',
  phone: '',
  whatsapp: '',
  residence: '',
  building: '',
  room: '',
  zoneId: null,
  addressDetails: '',
  foodPreferences: '',
  allergies: '',
  foodsToAvoid: '',
  notes: '',
  status: 'active'
};

export function CustomerForm({ initialValues, onSubmit, submitLabel }: CustomerFormProps) {
  const zones = useQuery({ queryKey: ['delivery-zones'], queryFn: listDeliveryZones });
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<CustomerFormValues, unknown, CustomerPayload>({
    resolver: zodResolver(customerSchema),
    defaultValues: { ...defaults, ...initialValues }
  });

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="firstName"
        render={({ field }) => (
          <AppInput
            error={errors.firstName?.message}
            label="Prénom *"
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="lastName"
        render={({ field }) => (
          <AppInput
            error={errors.lastName?.message}
            label="Nom *"
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppInput
            error={errors.phone?.message}
            keyboardType="phone-pad"
            label="Téléphone *"
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder="0812345678"
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="whatsapp"
        render={({ field }) => (
          <AppInput
            error={errors.whatsapp?.message}
            keyboardType="phone-pad"
            label="WhatsApp"
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder="Laisser vide si identique"
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="residence"
        render={({ field }) => (
          <AppInput label="Résidence" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />
        )}
      />
      <View style={styles.row}>
        <Controller
          control={control}
          name="building"
          render={({ field }) => (
            <AppInput
              label="Bâtiment / bloc"
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              style={styles.flexInput}
              value={field.value}
            />
          )}
        />
        <Controller
          control={control}
          name="room"
          render={({ field }) => (
            <AppInput
              label="Chambre"
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              style={styles.flexInput}
              value={field.value}
            />
          )}
        />
      </View>
      <Controller
        control={control}
        name="zoneId"
        render={({ field }) => (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Zone de livraison</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chips}>
                {zones.data?.map((zone) => (
                  <Pressable
                    key={zone.id}
                    onPress={() => field.onChange(zone.id)}
                    style={[styles.chip, field.value === zone.id && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, field.value === zone.id && styles.chipTextSelected]}>{zone.name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
      />
      <Controller
        control={control}
        name="addressDetails"
        render={({ field }) => (
          <AppInput label="Adresse complémentaire" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />
        )}
      />
      <Controller
        control={control}
        name="foodPreferences"
        render={({ field }) => (
          <AppInput label="Préférences alimentaires" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />
        )}
      />
      <Controller
        control={control}
        name="allergies"
        render={({ field }) => (
          <AppInput label="Allergies" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />
        )}
      />
      <Controller
        control={control}
        name="foodsToAvoid"
        render={({ field }) => (
          <AppInput label="Aliments à éviter" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />
        )}
      />
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Statut du client</Text>
            <View style={styles.chips}>
              {([
                { value: 'active', label: 'Actif' },
                { value: 'inactive', label: 'Inactif' },
                { value: 'former_customer', label: 'Ancien client' }
              ] as const).map((status) => (
                <Pressable
                  key={status.value}
                  onPress={() => field.onChange(status.value)}
                  style={[styles.chip, field.value === status.value && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, field.value === status.value && styles.chipTextSelected]}>{status.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />
      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <AppInput
            label="Notes internes"
            multiline
            numberOfLines={4}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            style={styles.notes}
            textAlignVertical="top"
            value={field.value}
          />
        )}
      />
      <AppButton label={submitLabel} loading={isSubmitting} onPress={() => void handleSubmit(onSubmit)()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flexInput: { flex: 1 },
  fieldGroup: { gap: spacing.sm },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.round,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { color: colors.muted, fontWeight: '600' },
  chipTextSelected: { color: colors.primaryDark },
  notes: { minHeight: 100 }
});
