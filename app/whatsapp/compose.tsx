import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { getMessageTemplate } from '@/features/alerts/alerts.service';
import { getErrorMessage } from '@/lib/errors';
import { buildWhatsAppAppUrl, buildWhatsAppUrl } from '@/lib/phone';
import { colors, spacing } from '@/theme/colors';

export default function WhatsAppComposeScreen() {
  const params = useLocalSearchParams<{
    phone: string;
    customerName?: string;
    templateCode?: string;
    expirationDate?: string;
    initialMessage?: string;
    inviteLink?: string;
  }>();
  const initialized = useRef(false);
  const [message, setMessage] = useState('');
  const template = useQuery({
    queryKey: ['message-template', params.templateCode],
    queryFn: () => getMessageTemplate(params.templateCode!),
    enabled: Boolean(params.templateCode)
  });

  useEffect(() => {
    if (initialized.current || (!params.initialMessage && params.templateCode && !template.data)) return;
    const source = params.initialMessage ?? template.data ?? `Bonjour ${params.customerName ?? ''}, `;
    setMessage(
      source
        .replaceAll('{customer_name}', params.customerName ?? '')
        .replaceAll('{expiration_date}', params.expirationDate ?? '')
    );
    initialized.current = true;
  }, [params.customerName, params.expirationDate, params.initialMessage, params.templateCode, template.data]);

  const copyInviteLink = async () => {
    if (!params.inviteLink) return;
    await Clipboard.setStringAsync(params.inviteLink);
    Alert.alert('Lien copié', 'Le lien d’invitation est prêt à être collé.');
  };

  const shareMessage = async () => {
    if (!message.trim()) return;
    await Share.share({ message: message.trim(), title: 'Invitation Your Food Admin' });
  };

  const openWhatsApp = async () => {
    if (!message.trim()) {
      Alert.alert('Message vide', 'Rédigez le message avant de continuer.');
      return;
    }
    try {
      const url = Platform.OS === 'web'
        ? buildWhatsAppUrl(params.phone, message.trim())
        : buildWhatsAppAppUrl(params.phone, message.trim());
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(
        'WhatsApp indisponible',
        `${getErrorMessage(error)} Vous pouvez copier le lien ou utiliser le partage natif.`,
        [
          { text: 'Fermer', style: 'cancel' },
          ...(params.inviteLink ? [{ text: 'Copier le lien', onPress: () => void copyInviteLink() }] : []),
          { text: 'Partager', onPress: () => void shareMessage() }
        ]
      );
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>Message pour {params.customerName || 'le client'}</Text>
      <Text style={styles.help}>Relisez et modifiez librement le texte avant d’ouvrir WhatsApp. Aucun message n’est envoyé automatiquement.</Text>
      {template.error ? <Text style={styles.error}>{getErrorMessage(template.error)}</Text> : null}
      <AppInput
        editable={!template.isLoading}
        label="Message WhatsApp"
        multiline
        numberOfLines={8}
        onChangeText={setMessage}
        textAlignVertical="top"
        value={message}
      />
      <AppButton disabled={template.isLoading} label="Ouvrir WhatsApp" onPress={() => void openWhatsApp()} />
      {params.inviteLink ? (
        <View style={styles.actions}>
          <View style={styles.action}>
            <AppButton label="Copier le lien" onPress={() => void copyInviteLink()} variant="secondary" />
          </View>
          <View style={styles.action}>
            <AppButton label="Partager" onPress={() => void shareMessage()} variant="ghost" />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 20, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 }
});
