import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Screen } from '@/components/ui/Screen';
import {
  accessLinkFor,
  buildAccessMessage,
  issueMissingAccessCodes,
  type BulkAccessRow
} from '@/features/client-access/access.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

/**
 * Envoi groupé : prépare un code pour chaque client actif qui n'a pas encore de compte, puis permet d'ouvrir WhatsApp
 * pour chacun (l'administratrice relit et envoie le message elle-même ; rien n'est envoyé automatiquement).
 */
export default function BulkAccessScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<BulkAccessRow[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);

  const generate = useMutation({
    mutationFn: issueMissingAccessCodes,
    onSuccess: async (result) => {
      setRows(result);
      setConfirm(false);
      await queryClient.invalidateQueries({ queryKey: ['access'] });
    },
    onError: () => setConfirm(false)
  });

  const openWhatsApp = (row: BulkAccessRow) => {
    const link = accessLinkFor(row.firstName, row.lastName, row.code);
    setSent((current) => new Set(current).add(row.customerId));
    router.push({
      pathname: '/whatsapp/compose',
      params: {
        phone: row.phone ?? '',
        customerName: row.firstName,
        initialMessage: buildAccessMessage({ firstName: row.firstName, link, code: row.code }),
        inviteLink: link
      }
    });
  };

  return (
    <Screen>
      <Text style={styles.title}>Accès des clients</Text>
      <Text style={styles.help}>
        Prépare le lien et le code de tous les clients qui n’ont pas encore de compte. Chaque client ouvre son lien, vérifie son nom,
        choisit son mot de passe et retrouve ses informations.
      </Text>

      {!rows ? (
        <AppButton label="Préparer les accès" loading={generate.isPending} onPress={() => setConfirm(true)} />
      ) : rows.length === 0 ? (
        <Card><Text style={styles.help}>Tous les clients actifs ont déjà un compte.</Text></Card>
      ) : (
        <>
          <Text style={styles.count}>{rows.length} client{rows.length > 1 ? 's' : ''} à contacter · {sent.size} déjà ouvert{sent.size > 1 ? 's' : ''}</Text>
          {rows.map((row) => (
            <Card key={row.customerId} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{row.firstName} {row.lastName}</Text>
                <Text style={styles.meta}>{row.phone ?? 'Pas de numéro : remise du lien ou du QR code en main propre'} · code {row.code}</Text>
              </View>
              <Pressable
                accessibilityLabel={`Envoyer l’accès à ${row.firstName}`}
                accessibilityRole="button"
                onPress={() => openWhatsApp(row)}
                style={[styles.send, sent.has(row.customerId) && styles.sendDone]}
              >
                <Ionicons color={colors.white} name={sent.has(row.customerId) ? 'checkmark' : 'logo-whatsapp'} size={20} />
              </Pressable>
            </Card>
          ))}
        </>
      )}
      {generate.error ? <Text accessibilityRole="alert" style={styles.error}>{getErrorMessage(generate.error)}</Text> : null}

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Préparer les accès"
        loading={generate.isPending}
        message="Un code est créé pour chaque client actif sans compte (ou son code actuel est repris). Les codes déjà valables ne changent pas."
        onCancel={() => setConfirm(false)}
        onConfirm={() => generate.mutate()}
        title="Préparer tous les accès ?"
        visible={confirm}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 24, fontWeight: '900' },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  count: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12 },
  send: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: radii.round, backgroundColor: '#168C4B' },
  sendDone: { backgroundColor: colors.muted },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' }
});
