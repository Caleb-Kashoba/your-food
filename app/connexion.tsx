import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ClientAuthShell } from '@/components/ClientAuthShell';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AccessError, signInClient } from '@/features/client-access/client-access.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

export default function ClientSignInScreen() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [last4, setLast4] = useState('');
  const [needLast4, setNeedLast4] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!login.trim() || !password) {
      setError('Entre ton nom et ton mot de passe.');
      return;
    }
    if (needLast4 && last4.trim().length !== 4) {
      setError('Entre les 4 derniers chiffres de ton numéro.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // La navigation vers le menu est déclenchée par la session ouverte (voir app/_layout.tsx)
      await signInClient({ login, password, last4 });
    } catch (caught) {
      if (caught instanceof AccessError && caught.kind === 'need_last4') setNeedLast4(true);
      setError(caught instanceof AccessError ? caught.message : getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ClientAuthShell title="Bon retour." subtitle="Ton repas du jour t’attend.">
      <AppInput
        autoCapitalize="words"
        autoComplete="username"
        label="Ton prénom et ton nom"
        onChangeText={(value) => {
          setLogin(value);
          setNeedLast4(false);
        }}
        placeholder="Ex. Mireille Kabongo"
        value={login}
      />
      {needLast4 ? (
        <AppInput
          keyboardType="number-pad"
          label="4 derniers chiffres de ton numéro"
          maxLength={4}
          onChangeText={setLast4}
          placeholder="1234"
          value={last4}
        />
      ) : null}
      <AppInput
        autoComplete="current-password"
        label="Ton mot de passe"
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
        secureTextEntry
        value={password}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <AppButton label="Se connecter" loading={loading} onPress={() => void submit()} />
      <Pressable onPress={() => router.push('/premiere-connexion')} style={styles.link}>
        <Text style={styles.linkText}>Première fois ? Entre avec ton code</Text>
      </Pressable>
      <Text style={styles.help}>Un trou de mémoire ? L’administratrice te dépannera.</Text>
      <Pressable onPress={() => router.push('/sign-in')} style={styles.link}>
        <Text style={styles.team}>Espace équipe</Text>
      </Pressable>
    </ClientAuthShell>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  link: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: -spacing.xs },
  team: { color: colors.muted, fontSize: 12, fontWeight: '700' }
});
