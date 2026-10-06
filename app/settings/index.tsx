import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import {
  getDefaultMinVotes,
  listAlertRules,
  listMessageTemplates,
  setDefaultMinVotes,
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
      <MinVotesEditor />
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

/** Seuil de votes avant que le repas par défaut suive le plus choisi (5 par défaut) */
function MinVotesEditor() {
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: ['default-min-votes'], queryFn: getDefaultMinVotes });
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  if (current.isLoading) return null;
  if (current.error) return <Text style={styles.description}>{getErrorMessage(current.error)}</Text>;
  const shown = value ?? String(current.data ?? 5);
  const save = async () => {
    const votes = Number(shown);
    if (!Number.isInteger(votes) || votes < 0 || votes > 100) {
      Alert.alert('Valeur invalide', 'Saisissez un nombre entier entre 0 et 100.');
      return;
    }
    try {
      setSaving(true);
      await setDefaultMinVotes(votes);
      await queryClient.invalidateQueries({ queryKey: ['default-min-votes'] });
      setValue(null);
      setSaved(true);
    } catch (error) {
      Alert.alert('Enregistrement impossible', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Repas par défaut</Text>
        <Text style={styles.description}>
          Les clients qui n’ont rien choisi reçoivent le repas le plus choisi, mais seulement à partir d’un nombre minimum de choix dans la catégorie.
          En dessous, ils reçoivent le premier plat par ordre alphabétique. Mettez 0 pour toujours suivre le plus choisi.
        </Text>
      </View>
      <View style={styles.rule}>
        <AppInput keyboardType="number-pad" label="Choix minimum" onChangeText={(text) => { setValue(text); setSaved(false); }} value={shown} />
        <AppButton label={saved ? 'Enregistré' : 'Enregistrer'} loading={saving} onPress={() => void save()} variant="secondary" />
      </View>
    </>
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
