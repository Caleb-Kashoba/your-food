import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import {
  listAlertRules,
  listMessageTemplates,
  updateAlertRule,
  updateMessageTemplate,
  type AlertRule,
  type MessageTemplate
} from '@/features/settings/settings.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

export default function SettingsScreen() {
  const rules = useQuery({ queryKey: ['alert-rules'], queryFn: listAlertRules });
  const templates = useQuery({ queryKey: ['message-templates'], queryFn: listMessageTemplates });
  const queryClient = useQueryClient();
  if (rules.isLoading || templates.isLoading) return <LoadingView />;
  if (rules.error || templates.error) {
    return <ErrorView message={getErrorMessage(rules.error ?? templates.error)} onRetry={() => void Promise.all([rules.refetch(), templates.refetch()])} />;
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Rappels d’expiration</Text>
        <Text style={styles.description}>Nombre de jours avant la fin de l’abonnement. Le jour J correspond à 0.</Text>
      </View>
      {rules.data?.map((rule) => (
        <RuleEditor
          key={rule.id}
          rule={rule}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['alert-rules'] })}
        />
      ))}
      <View style={styles.header}>
        <Text style={styles.title}>Modèles WhatsApp</Text>
        <Text style={styles.description}>Variables disponibles : {'{customer_name}'} et {'{expiration_date}'}. Le message reste modifiable avant l’ouverture de WhatsApp.</Text>
      </View>
      {templates.data?.map((template) => (
        <TemplateEditor
          key={template.id}
          template={template}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['message-templates'] })}
        />
      ))}
      <View style={styles.note}>
        <Text style={styles.noteTitle}>Paramètres techniques</Text>
        <Text style={styles.description}>Les secrets serveur, identifiants EAS et clés de signature ne sont jamais stockés dans l’application mobile.</Text>
      </View>
    </Screen>
  );
}

function TemplateEditor({ template, onSaved }: { template: MessageTemplate; onSaved: () => Promise<unknown> }) {
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!body.trim()) {
      Alert.alert('Message vide', 'Le modèle doit contenir un texte.');
      return;
    }
    try {
      setSaving(true);
      await updateMessageTemplate(template.id, body, template.isActive);
      await onSaved();
    } catch (error) {
      Alert.alert('Enregistrement impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={styles.rule}>
      <Text style={styles.ruleName}>{template.name}</Text>
      <AppInput label="Texte" multiline onChangeText={setBody} textAlignVertical="top" value={body} />
      <AppButton label="Enregistrer le modèle" loading={saving} onPress={() => void save()} variant="secondary" />
    </View>
  );
}

function RuleEditor({ rule, onSaved }: { rule: AlertRule; onSaved: () => Promise<unknown> }) {
  const [value, setValue] = useState(String(rule.daysBefore));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 90) {
      Alert.alert('Valeur invalide', 'Saisissez un nombre entier entre 0 et 90.');
      return;
    }
    try {
      setSaving(true);
      await updateAlertRule(rule.id, days, rule.isActive);
      await onSaved();
    } catch (error) {
      Alert.alert('Enregistrement impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.rule}>
      <Text style={styles.ruleName}>{rule.name}</Text>
      <AppInput keyboardType="number-pad" label="Jours avant expiration" onChangeText={setValue} value={value} />
      <AppButton label="Enregistrer" loading={saving} onPress={() => void save()} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  title: { color: colors.primaryDark, fontSize: 20, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  rule: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  ruleName: { color: colors.text, fontSize: 16, fontWeight: '800' },
  note: { backgroundColor: colors.warningSoft, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  noteTitle: { color: colors.warning, fontSize: 16, fontWeight: '800' }
});
