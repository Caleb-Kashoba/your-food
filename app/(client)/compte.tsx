import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { changeMyPassword, getAccount } from '@/features/client-area/client.service';
import { formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { colors, spacing } from '@/theme/colors';

const STATE_LABEL: Record<string, string> = {
  actif: 'Actif',
  bientot_expire: 'Bientôt expiré',
  expire: 'Expiré',
  non_commence: 'À venir',
  suspendu: 'En pause',
  annule: 'Annulé',
  aucun: 'Aucun abonnement'
};

export default function ClientAccountScreen() {
  const { signOut } = useAuth();
  const account = useQuery({ queryKey: ['client', 'account'], queryFn: getAccount });

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const change = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 8) throw new Error('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      if (newPassword !== confirmation) throw new Error('Les deux mots de passe ne sont pas identiques.');
      await changeMyPassword(oldPassword, newPassword);
    },
    onSuccess: () => {
      setOldPassword('');
      setNewPassword('');
      setConfirmation('');
      setMessage({ text: 'Mot de passe modifié.', ok: true });
    },
    onError: (caught) => setMessage({ text: getErrorMessage(caught), ok: false })
  });

  if (account.isLoading) return <LoadingView />;
  if (!account.data) return <ErrorView message={getErrorMessage(account.error)} onRetry={() => void account.refetch()} />;

  const { customer, subscription, balance, payments } = account.data;

  return (
    <Screen>
      <Text style={styles.title}>{customer.first_name} {customer.last_name}</Text>

      <Card style={styles.card}>
        <Text style={styles.section}>Mon abonnement</Text>
        <Row label="Formule" value={subscription.plan_name ?? '—'} />
        <Row label="État" value={STATE_LABEL[subscription.state] ?? subscription.state} />
        {subscription.start_date && subscription.end_date ? (
          <Row label="Période" value={`${formatLocalDate(subscription.start_date)} → ${formatLocalDate(subscription.end_date)}`} />
        ) : null}
        {subscription.working_days_left !== undefined && ['actif', 'bientot_expire'].includes(subscription.state) ? (
          <Row label="Jours de repas restants" value={String(subscription.working_days_left)} />
        ) : null}
      </Card>

      {balance ? (
        <Card style={styles.card}>
          <Text style={styles.section}>Mes paiements</Text>
          <Row label="Prix de l’abonnement" value={formatMoney(balance.price, balance.currency)} />
          <Row label="Déjà payé" value={formatMoney(balance.paid, balance.currency)} />
          <Row label="Reste à payer" strong value={formatMoney(balance.remaining, balance.currency)} />
          {payments.map((payment, index) => (
            <Text key={`${payment.paid_at}-${index}`} style={styles.payment}>
              {formatLocalDate(payment.paid_at)} · {formatMoney(payment.amount, payment.currency)} · {payment.method}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.section}>Changer mon mot de passe</Text>
        <AppInput autoComplete="current-password" label="Mot de passe actuel" onChangeText={setOldPassword} secureTextEntry value={oldPassword} />
        <AppInput autoComplete="new-password" label="Nouveau mot de passe (8 caractères minimum)" onChangeText={setNewPassword} secureTextEntry value={newPassword} />
        <AppInput autoComplete="new-password" label="Répète le nouveau mot de passe" onChangeText={setConfirmation} secureTextEntry value={confirmation} />
        {message ? <Text accessibilityRole="alert" style={message.ok ? styles.ok : styles.error}>{message.text}</Text> : null}
        <AppButton disabled={!oldPassword || !newPassword} label="Changer mon mot de passe" loading={change.isPending} onPress={() => change.mutate()} />
      </Card>

      <AppButton label="Se déconnecter" onPress={() => void signOut()} variant="secondary" />
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 32, fontWeight: '900', letterSpacing: -0.8 },
  card: { gap: spacing.md },
  section: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted, fontSize: 14 },
  value: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  strong: { color: colors.primary, fontWeight: '900' },
  payment: { color: colors.muted, fontSize: 13 },
  ok: { color: colors.success, fontSize: 14, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' }
});
