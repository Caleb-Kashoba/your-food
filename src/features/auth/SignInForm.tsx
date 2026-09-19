import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/features/auth/AuthProvider';
import { signInSchema, type SignInValues } from '@/features/auth/sign-in.schema';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

export function SignInForm() {
  const { signIn } = useAuth();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' }
  });

  const submit = handleSubmit(async (values) => {
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      Alert.alert('Connexion impossible', getErrorMessage(error));
    }
  });

  return (
    <View style={styles.form}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>BON RETOUR</Text>
        <Text style={styles.title}>Connexion</Text>
        <Text style={styles.subtitle}>Accédez à l’administration de Your Food avec votre compte personnel.</Text>
      </View>
      <Controller
        control={control}
        name="email"
        render={({ field: { onBlur, onChange, value } }) => (
          <AppInput
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email?.message}
            keyboardType="email-address"
            label="Adresse e-mail"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onBlur, onChange, value } }) => (
          <AppInput
            autoCapitalize="none"
            error={errors.password?.message}
            label="Mot de passe"
            onBlur={onBlur}
            onChangeText={onChange}
            secureTextEntry
            value={value}
          />
        )}
      />
      <AppButton label="Ouvrir mon espace" loading={isSubmitting} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  heading: { gap: spacing.xs, marginBottom: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.primaryDark, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21 }
});
