import { Alert, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { BrandLogo } from '@/components/BrandLogo';
import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

export default function BootstrapScreen() {
  const { bootstrap, signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  const initialize = async () => {
    try {
      setLoading(true);
      await bootstrap();
    } catch (error) {
      Alert.alert('Initialisation impossible', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen contentContainerStyle={styles.content}>
      <BrandLogo compact showTagline />
      <Card style={styles.card}>
        <View style={styles.step}><Text style={styles.stepText}>CONFIGURATION INITIALE</Text></View>
        <Text style={styles.title}>Premier compte technique</Text>
        <Text style={styles.body}>
          Cette action attribue le rôle root uniquement si aucun root actif n’existe. La base verrouille l’opération pour
          empêcher deux initialisations simultanées.
        </Text>
        <AppButton label="Initialiser ce compte comme root" loading={loading} onPress={() => void initialize()} />
        <AppButton label="Se déconnecter" onPress={() => void signOut()} variant="ghost" />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', gap: spacing.lg },
  card: { gap: spacing.md, borderTopColor: colors.primary, borderTopWidth: 4 },
  step: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  stepText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.primaryDark, fontSize: 24, fontWeight: '900' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 }
});
