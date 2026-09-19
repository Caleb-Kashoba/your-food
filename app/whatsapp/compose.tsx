import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { getMessageTemplate } from '@/features/alerts/alerts.service';
import { getErrorMessage } from '@/lib/errors';
import { buildWhatsAppUrl } from '@/lib/phone';
import { colors, spacing } from '@/theme/colors';

export default function WhatsAppComposeScreen() {
  const params = useLocalSearchParams<{
    phone: string;
    customerName?: string;
    templateCode?: string;
    expirationDate?: string;
  }>();
  const initialized = useRef(false);
  const [message, setMessage] = useState('');
  const template = useQuery({
    queryKey: ['message-template', params.templateCode],
    queryFn: () => getMessageTemplate(params.templateCode!),
    enabled: Boolean(params.templateCode)
  });

  useEffect(() => {
    if (initialized.current || (params.templateCode && !template.data)) return;
    const source = template.data ?? `Bonjour ${params.customerName ?? ''}, `;
    setMessage(
      source
        .replaceAll('{customer_name}', params.customerName ?? '')
        .replaceAll('{expiration_date}', params.expirationDate ?? '')
    );
    initialized.current = true;
  }, [params.customerName, params.expirationDate, params.templateCode, template.data]);

  const openWhatsApp = async () => {
    if (!message.trim()) {
      Alert.alert('Message vide', 'Rédigez le message avant de continuer.');
      return;
    }
    try {
      await Linking.openURL(buildWhatsAppUrl(params.phone, message.trim()));
    } catch (error) {
      Alert.alert('WhatsApp indisponible', getErrorMessage(error));
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 20, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm }
});
