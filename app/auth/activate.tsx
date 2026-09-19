import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { setInvitedUserPassword } from '@/features/auth/auth.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

export default function ActivateAccountScreen() {
  const router = useRouter();
  const { session, member, loading, error, refreshMember } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activate = async () => {
    if (password.length < 8) {
      Alert.alert('Mot de passe trop court', 'Utilisez au moins 8 caractères.');
      return;
    }
    if (password !== confirmation) {
      Alert.alert('Confirmation incorrecte', 'Les deux mots de passe ne correspondent pas.');
      return;
    }

    try {
      setSubmitting(true);
      await setInvitedUserPassword(password);
      await refreshMember();
      Alert.alert('Compte activé', 'Votre compte Your Food Admin est prêt.');
      router.replace('/(tabs)');
    } catch (caught) {
      Alert.alert('Activation impossible', getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <Text style={styles.title}>Validation de l’invitation…</Text>
        <Text style={styles.help}>Veuillez patienter pendant la sécurisation de votre session.</Text>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen contentContainerStyle={styles.centered}>
        <View style={styles.errorCard}>
          <Text style={styles.title}>Invitation non valide</Text>
          <Text style={styles.errorText}>
            {error ?? 'Ce lien est invalide, a expiré ou a déjà été utilisé. Demandez une nouvelle invitation.'}
          </Text>
          <AppButton label="Revenir à la connexion" onPress={() => router.replace('/sign-in')} variant="secondary" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.centered}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>INVITATION ACCEPTÉE</Text>
        <Text style={styles.title}>Définissez votre mot de passe</Text>
        <Text style={styles.help}>
          {member
            ? `Bienvenue ${member.displayName}. Choisissez le mot de passe de votre compte ${member.role}.`
            : 'Choisissez le mot de passe qui protégera votre compte Your Food Admin.'}
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <AppInput
          autoCapitalize="none"
          label="Nouveau mot de passe"
          onChangeText={setPassword}
          secureTextEntry
          value={password}
        />
        <AppInput
          autoCapitalize="none"
          label="Confirmer le mot de passe"
          onChangeText={setConfirmation}
          secureTextEntry
          value={confirmation}
        />
        <AppButton label="Activer mon compte" loading={submitting} onPress={() => void activate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  card: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg
  },
  errorCard: {
    gap: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg
  },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: colors.primaryDark, fontSize: 24, fontWeight: '900' },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 21 }
});
