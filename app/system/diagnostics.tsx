import Constants from 'expo-constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform, StyleSheet, Text, View, Alert } from 'react-native';
import { useState } from 'react';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { listTechnicalSettings, updateTechnicalSetting, type TechnicalSetting } from '@/features/system/system.service';
import { env } from '@/lib/env';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

export default function DiagnosticsScreen() {
  const settings = useQuery({ queryKey: ['technical-settings'], queryFn: listTechnicalSettings });
  const queryClient = useQueryClient();
  const config = Constants.expoConfig;
  const rows = [
    ['Application', config?.name ?? 'Your Food'],
    ['Version', config?.version ?? 'inconnue'],
    ['Plateforme', `${Platform.OS} ${String(Platform.Version)}`],
    ['Package Android', config?.android?.package ?? 'non défini'],
    ['Bundle iOS', config?.ios?.bundleIdentifier ?? 'non défini'],
    ['Projet EAS', config?.extra?.eas?.projectId ? 'lié' : 'à lier'],
    ['Supabase', env ? 'configuré' : 'non configuré']
  ];

  if (settings.isLoading) return <LoadingView />;
  if (settings.error) return <ErrorView message={getErrorMessage(settings.error)} onRetry={() => void settings.refetch()} />;

  return (
    <Screen>
      <View style={styles.status}><Text style={styles.statusText}>Aucun secret serveur n’est exposé dans cet écran.</Text></View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{String(value)}</Text>
        </View>
      ))}
      <Text style={styles.sectionTitle}>Paramètres techniques</Text>
      <Text style={styles.help}>Valeurs JSON non secrètes, réservées au rôle root. Chaque modification est auditée dans PostgreSQL.</Text>
      {settings.data?.map((setting) => (
        <TechnicalSettingEditor
          key={setting.id}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['technical-settings'] })}
          setting={setting}
        />
      ))}
    </Screen>
  );
}

function TechnicalSettingEditor({ setting, onSaved }: { setting: TechnicalSetting; onSaved: () => Promise<unknown> }) {
  const [value, setValue] = useState(JSON.stringify(setting.value));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    try {
      setSaving(true);
      await updateTechnicalSetting(setting.id, JSON.parse(value) as unknown);
      await onSaved();
    } catch (error) {
      Alert.alert('Valeur JSON invalide ou refusée', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={styles.setting}>
      <AppInput label={setting.key} multiline onChangeText={setValue} value={value} />
      <AppButton label="Enregistrer" loading={saving} onPress={() => void save()} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  status: { backgroundColor: colors.successSoft, borderRadius: radii.md, padding: spacing.md },
  statusText: { color: colors.success, fontWeight: '700' },
  sectionTitle: { color: colors.primaryDark, fontSize: 18, fontWeight: '800', marginTop: spacing.md },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  setting: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, gap: spacing.sm, padding: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  label: { color: colors.muted },
  value: { flex: 1, color: colors.text, fontWeight: '700', textAlign: 'right' }
});
