import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { QrCode } from '@/components/QrCode';
import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import {
  accessLinkFor,
  buildAccessMessage,
  getOpenAccessCode,
  issueAccessCode,
  type AccessCodeType
} from '@/features/client-access/access.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';
import type { Customer } from '@/types/domain';

/** Fiche « Accès client » : code, lien, message WhatsApp et QR code à remettre en main propre */
export function AccessCard({ customer }: { customer: Customer }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  const open = useQuery({ queryKey: ['access', customer.id], queryFn: () => getOpenAccessCode(customer.id) });

  const issue = useMutation({
    mutationFn: (type: AccessCodeType) => issueAccessCode(customer.id, type),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['access', customer.id] });
    },
    onError: (caught) => setError(getErrorMessage(caught))
  });

  const code = open.data?.code;
  const isReset = open.data?.type === 'reset';
  const nextType: AccessCodeType = customer.hasAccount ? 'reset' : 'activation';
  const link = code ? accessLinkFor(customer.firstName, customer.lastName, code) : null;
  const message = code && link ? buildAccessMessage({ firstName: customer.firstName, link, code, reset: isReset }) : '';
  const phone = customer.whatsapp || customer.phone;

  const generate = () => {
    if (code) {
      setConfirmNew(true);
      return;
    }
    issue.mutate(nextType);
  };

  const copyLink = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Accès client</Text>
        <View style={[styles.pill, customer.hasAccount ? styles.pillOk : styles.pillWait]}>
          <Text style={styles.pillText}>{customer.hasAccount ? 'compte activé' : 'pas encore activé'}</Text>
        </View>
      </View>

      {!code ? (
        <Text style={styles.help}>
          {customer.hasAccount
            ? 'Le client se connecte avec son prénom, son nom et son mot de passe. Génère un code s’il l’a oublié.'
            : 'Génère un code : le client l’utilisera pour créer son mot de passe (par lien WhatsApp ou QR code).'}
        </Text>
      ) : (
        <View style={styles.codeBlock}>
          <Text style={styles.codeLabel}>{isReset ? 'Code de réinitialisation' : 'Code d’activation'}</Text>
          <Text selectable style={styles.code}>{code}</Text>
          {open.data && open.data.attempts >= 10 ? <Text style={styles.error}>Code verrouillé après trop d’essais : génère-en un nouveau.</Text> : null}
        </View>
      )}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {code && link ? (
        <View style={styles.actions}>
          <AppButton
            disabled={!phone}
            label="Envoyer par WhatsApp"
            onPress={() =>
              router.push({
                pathname: '/whatsapp/compose',
                params: { phone: phone ?? '', customerName: customer.firstName, initialMessage: message, inviteLink: link }
              })
            }
          />
          <AppButton label={copied ? 'Lien copié ✓' : 'Copier le lien'} onPress={() => void copyLink()} variant="secondary" />
          <Pressable accessibilityRole="button" onPress={() => setShowQr((value) => !value)} style={styles.qrToggle}>
            <Ionicons color={colors.primary} name="qr-code-outline" size={20} />
            <Text style={styles.qrToggleText}>{showQr ? 'Masquer le QR code' : 'Afficher le QR code (remise en main propre)'}</Text>
          </Pressable>
          {showQr ? <View style={styles.qr}><QrCode value={link} /></View> : null}
          {!phone ? <Text style={styles.help}>Pas de numéro : montre le QR code ou copie le lien.</Text> : null}
        </View>
      ) : null}

      <AppButton
        label={customer.hasAccount ? 'Réinitialiser le mot de passe' : code ? 'Régénérer le code' : 'Générer le code d’accès'}
        loading={issue.isPending}
        onPress={generate}
        variant={code ? 'ghost' : 'secondary'}
      />

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Créer le code"
        loading={issue.isPending}
        message="L’ancien code ne fonctionnera plus : envoie le nouveau au client."
        onCancel={() => setConfirmNew(false)}
        onConfirm={() => {
          setConfirmNew(false);
          issue.mutate(nextType);
        }}
        title="Créer un nouveau code ?"
        visible={confirmNew}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  pill: { borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  pillOk: { backgroundColor: colors.successSoft },
  pillWait: { backgroundColor: colors.warningSoft },
  pillText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  codeBlock: { alignItems: 'center', backgroundColor: colors.cream, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: spacing.xs, padding: spacing.md },
  codeLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  code: { color: colors.primaryDark, fontSize: 30, fontWeight: '900', letterSpacing: 4 },
  actions: { gap: spacing.sm },
  qrToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  qrToggleText: { color: colors.primary, fontSize: 14, fontWeight: '800', flex: 1 },
  qr: { alignItems: 'center', padding: spacing.md, backgroundColor: colors.white, borderRadius: radii.lg },
  error: { color: colors.danger, fontSize: 13, fontWeight: '600' }
});
