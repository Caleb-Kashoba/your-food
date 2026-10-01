import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConnectivityBanner } from '@/components/ConnectivityBanner';
import { LoadingView } from '@/components/ui/StateViews';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { envError } from '@/lib/env';
import { queryClient } from '@/lib/query-client';
import { installWebAlert } from '@/lib/web-alert';
import { colors, spacing } from '@/theme/colors';

installWebAlert();

/** Écrans publics du client (connexion, première connexion, lien reçu par WhatsApp ou QR code) */
const CLIENT_PUBLIC_PATHS = ['/connexion', '/premiere-connexion', '/bienvenue'];
/** Espace du client connecté */
const CLIENT_AREA_PATHS = ['/menu', '/historique', '/compte'];

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AppNavigator() {
  const { session, member, customer, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || envError) return;
    const onSignIn = pathname === '/sign-in';
    const onBootstrap = pathname === '/bootstrap';
    const onActivation = pathname === '/auth/activate';
    const onClientPublic = CLIENT_PUBLIC_PATHS.includes(pathname);
    const onClientArea = CLIENT_AREA_PATHS.includes(pathname);

    if (!session) {
      // Web : les clients arrivent par leur lien ou la page de connexion ; mobile : application de l'équipe
      if (!onSignIn && !onActivation && !onClientPublic) {
        router.replace(Platform.OS === 'web' ? '/connexion' : '/sign-in');
      }
    } else if (member) {
      if (onSignIn || onBootstrap || onClientPublic || onClientArea || pathname === '/') router.replace('/(tabs)');
    } else if (customer) {
      // Un client n'accède qu'à son espace
      if (!onClientArea) router.replace('/menu');
    } else if (!onBootstrap && !onActivation) {
      router.replace('/bootstrap');
    }
  }, [customer, loading, member, pathname, router, session]);

  if (envError) {
    return (
      <View style={styles.configuration}>
        <Text style={styles.configurationTitle}>Configuration requise</Text>
        <Text style={styles.configurationText}>{envError}</Text>
        <Text style={styles.configurationText}>Consultez le fichier .env.example à la racine du projet.</Text>
      </View>
    );
  }

  if (loading) return <LoadingView label="Ouverture de Your Food…" />;

  return (
    <View style={styles.outer}>
    <View style={styles.shell}>
      <ConnectivityBanner />
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primaryDark,
          headerTitleStyle: { fontWeight: '900' },
          headerShadowVisible: false
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/activate" options={{ title: 'Activer mon compte', headerBackVisible: false }} />
        <Stack.Screen name="connexion" options={{ headerShown: false }} />
        <Stack.Screen name="premiere-connexion" options={{ headerShown: false }} />
        <Stack.Screen name="bienvenue" options={{ headerShown: false }} />
        <Stack.Screen name="(client)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="bootstrap" options={{ title: 'Initialisation sécurisée', headerBackVisible: false }} />
        <Stack.Screen name="customers/access" options={{ title: 'Accès des clients' }} />
        <Stack.Screen name="catalog/index" options={{ title: 'Carte des plats' }} />
        <Stack.Screen name="menus/index" options={{ title: 'Menus' }} />
        <Stack.Screen name="menus/publish" options={{ title: 'Publier un menu' }} />
        <Stack.Screen name="orders/live" options={{ title: 'Suivi du jour' }} />
        <Stack.Screen name="reviews/index" options={{ title: 'Avis des clients' }} />
        <Stack.Screen name="stats/index" options={{ title: 'Statistiques' }} />
        <Stack.Screen name="customers/new" options={{ title: 'Nouveau client' }} />
        <Stack.Screen name="customers/[id]" options={{ title: 'Fiche client' }} />
        <Stack.Screen name="customers/[id]/edit" options={{ title: 'Modifier le client' }} />
        <Stack.Screen name="plans/index" options={{ title: 'Formules' }} />
        <Stack.Screen name="plans/new" options={{ title: 'Nouvelle formule' }} />
        <Stack.Screen name="plans/[id]/edit" options={{ title: 'Modifier la formule' }} />
        <Stack.Screen name="subscriptions/index" options={{ title: 'Abonnements' }} />
        <Stack.Screen name="subscriptions/new" options={{ title: 'Nouvel abonnement' }} />
        <Stack.Screen name="subscriptions/[id]" options={{ title: 'Détail de l’abonnement' }} />
        <Stack.Screen name="alerts/index" options={{ title: 'Alertes' }} />
        <Stack.Screen name="payments/new" options={{ title: 'Enregistrer un paiement' }} />
        <Stack.Screen name="payments/index" options={{ title: 'Historique des paiements' }} />
        <Stack.Screen name="whatsapp/compose" options={{ title: 'Message WhatsApp' }} />
        <Stack.Screen name="users/index" options={{ title: 'Utilisateurs' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Paramètres' }} />
        <Stack.Screen name="system/audit" options={{ title: 'Journal d’audit' }} />
        <Stack.Screen name="system/permissions" options={{ title: 'Permissions globales' }} />
        <Stack.Screen name="system/diagnostics" options={{ title: 'Diagnostic système' }} />
        <Stack.Screen name="coming-soon" options={{ title: 'Bientôt disponible' }} />
      </Stack>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sur ordinateur, le contenu reste dans une colonne lisible, centrée
  outer: { flex: 1, backgroundColor: colors.background },
  shell: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  configuration: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    padding: spacing.xl
  },
  configurationTitle: { color: colors.danger, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  configurationText: { color: colors.text, fontSize: 16, lineHeight: 24, textAlign: 'center' }
});
