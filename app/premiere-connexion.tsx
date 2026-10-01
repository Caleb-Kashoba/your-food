import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ClientAuthShell } from '@/components/ClientAuthShell';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { isCompleteAccessCode, takePendingAccess } from '@/features/client-access/access-link';
import { AccessError, activateAccount, verifyAccessCode } from '@/features/client-access/client-access.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

type Step = 'code' | 'password';

/**
 * Première connexion en deux étapes : 1. nom + code reçu (vérifié sans être consommé) ;
 * 2. création du mot de passe (le code est alors consommé et la session ouverte).
 * Sert aussi après une réinitialisation du mot de passe par l'administratrice.
 */
export default function FirstLoginScreen() {
  const router = useRouter();
  // Lien reçu par WhatsApp ou QR code : nom et code déjà remplis
  const [pending] = useState(takePendingAccess);
  const [step, setStep] = useState<Step>('code');
  const [login, setLogin] = useState(pending?.name ?? '');
  const [code, setCode] = useState(pending?.code ?? '');
  const [last4, setLast4] = useState('');
  const [needLast4, setNeedLast4] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [isReset, setIsReset] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    if (!login.trim() || !isCompleteAccessCode(code)) {
      setError('Entre ton prénom, ton nom et le code à 8 caractères.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await verifyAccessCode({ login, code, last4 });
      setFirstName(result.firstName);
      setIsReset(result.type === 'reset');
      setStep('password');
    } catch (caught) {
      if (caught instanceof AccessError && caught.kind === 'need_last4') setNeedLast4(true);
      setError(caught instanceof AccessError ? caught.message : getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const createPassword = async () => {
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirmation) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // La session ouverte déclenche la navigation vers le menu (voir app/_layout.tsx)
      await activateAccount({ login, code, password, last4 });
    } catch (caught) {
      setError(caught instanceof AccessError ? caught.message : getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'password') {
    return (
      <ClientAuthShell
        subtitle="Rien qu’à toi, pour revenir à table chaque jour."
        title={isReset ? 'Nouveau mot de passe.' : 'Crée ton mot de passe.'}
      >
        <Text style={styles.ok}>Code accepté, bienvenue{firstName ? ` ${firstName}` : ''}.</Text>
        <AppInput
          autoComplete="new-password"
          label="Au moins 8 caractères"
          onChangeText={setPassword}
          secureTextEntry
          value={password}
        />
        <AppInput
          autoComplete="new-password"
          label="Répète le mot de passe"
          onChangeText={setConfirmation}
          onSubmitEditing={() => void createPassword()}
          secureTextEntry
          value={confirmation}
        />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <AppButton label="Créer et entrer" loading={loading} onPress={() => void createPassword()} />
      </ClientAuthShell>
    );
  }

  return (
    <ClientAuthShell
      subtitle={pending ? 'Ton code est prêt : vérifie ton nom et continue.' : 'Entre le code reçu sur WhatsApp pour commencer.'}
      title="Bienvenue à table."
    >
      <AppInput
        autoCapitalize="words"
        autoComplete="username"
        label="Ton prénom et ton nom"
        onChangeText={(value) => {
          setLogin(value);
          setNeedLast4(false);
        }}
        value={login}
      />
      {needLast4 ? (
        <AppInput
          keyboardType="number-pad"
          label="4 derniers chiffres de ton numéro"
          maxLength={4}
          onChangeText={setLast4}
          value={last4}
        />
      ) : null}
      <AppInput
        autoCapitalize="characters"
        autoCorrect={false}
        label="Code à 8 caractères"
        maxLength={9}
        onChangeText={setCode}
        onSubmitEditing={() => void verify()}
        value={code}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <AppButton label="Continuer" loading={loading} onPress={() => void verify()} />
      <Pressable onPress={() => router.replace('/connexion')} style={styles.link}>
        <Text style={styles.linkText}>J’ai déjà un mot de passe</Text>
      </Pressable>
    </ClientAuthShell>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  ok: { color: colors.success, fontSize: 14, fontWeight: '700', marginBottom: -spacing.xs },
  link: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '800' }
});
