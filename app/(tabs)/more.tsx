import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const links: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; href: Href; permission?: string }[] = [
  { label: 'Formules', icon: 'pricetags-outline' as const, href: '/plans' as const, permission: 'subscriptions.read' },
  { label: 'Abonnements', icon: 'repeat-outline' as const, href: '/subscriptions' as const, permission: 'subscriptions.read' },
  { label: 'Alertes', icon: 'notifications-outline' as const, href: '/alerts' as const, permission: 'subscriptions.read' },
  { label: 'Production', icon: 'restaurant-outline' as const, href: '/coming-soon?feature=Production' as const },
  { label: 'Stocks', icon: 'cube-outline' as const, href: '/coming-soon?feature=Stocks' as const, permission: 'stock.read' },
  { label: 'Rapports', icon: 'bar-chart-outline' as const, href: '/coming-soon?feature=Rapports' as const, permission: 'reports.read' },
  { label: 'Paramètres', icon: 'settings-outline' as const, href: '/settings' as const, permission: 'settings.business.write' },
  { label: 'Utilisateurs', icon: 'shield-checkmark-outline' as const, href: '/users' as const, permission: 'users.read' },
  { label: 'Journal d’audit', icon: 'reader-outline' as const, href: '/system/audit' as const, permission: 'system.audit.read' },
  { label: 'Permissions globales', icon: 'key-outline' as const, href: '/system/permissions' as const, permission: 'system.root.manage' },
  { label: 'Diagnostic système', icon: 'pulse-outline' as const, href: '/system/diagnostics' as const, permission: 'system.settings.write' }
];

export default function MoreScreen() {
  const router = useRouter();
  const { member, hasPermission, signOut } = useAuth();

  const logout = async () => {
    try {
      await signOut();
    } catch (error) {
      Alert.alert('Déconnexion impossible', getErrorMessage(error));
    }
  };

  return (
    <Screen>
      <BrandLogo compact showTagline />
      <View style={styles.profile}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{member?.displayName[0] ?? 'Y'}</Text></View>
        <View style={styles.grow}>
          <Text style={styles.name}>{member?.displayName}</Text>
          <Text style={styles.meta}>{member?.email}</Text>
          <View style={styles.rolePill}><Text style={styles.role}>{member?.role.toUpperCase()}</Text></View>
        </View>
      </View>
      <Text style={styles.menuLabel}>OUTILS DE GESTION</Text>
      <View style={styles.menu}>
        {links.filter((item) => !item.permission || hasPermission(item.permission)).map((item) => (
          <Pressable key={item.label} onPress={() => router.push(item.href)} style={styles.link}>
            <View style={styles.linkIcon}><Ionicons color={colors.primary} name={item.icon} size={22} /></View>
            <Text style={styles.linkText}>{item.label}</Text>
            <Ionicons color={colors.muted} name="chevron-forward" size={20} />
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => void logout()} style={styles.logout}>
        <Ionicons color={colors.danger} name="log-out-outline" size={22} />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primaryDark, borderRadius: radii.lg, padding: spacing.lg },
  avatar: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary },
  avatarText: { color: colors.surface, fontSize: 20, fontWeight: '800' },
  grow: { flex: 1 },
  name: { color: colors.white, fontSize: 18, fontWeight: '900' },
  meta: { color: colors.sand, fontSize: 13 },
  rolePill: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radii.round, marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  role: { color: colors.white, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  menuLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: spacing.sm },
  menu: { gap: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  linkIcon: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 15, backgroundColor: colors.primarySoft },
  linkText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  logoutText: { color: colors.danger, fontWeight: '700' }
});
