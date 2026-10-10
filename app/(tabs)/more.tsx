import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

interface MoreLink {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  href: Href;
  permission?: string;
}

interface MoreSection {
  title: string;
  links: MoreLink[];
}

const sections: MoreSection[] = [
  {
    title: 'AU QUOTIDIEN',
    links: [
      { label: 'Menus de la semaine', icon: 'calendar-number-outline' as const, href: '/menus' as const, permission: 'menus.read' },
      { label: 'Commandes du jour', icon: 'checkbox-outline' as const, href: '/orders/live' as const, permission: 'orders.read' },
      { label: 'Carte des plats', icon: 'fast-food-outline' as const, href: '/catalog' as const, permission: 'menus.read' },
      { label: 'Avis des clients', icon: 'chatbubble-ellipses-outline' as const, href: '/reviews' as const, permission: 'orders.read' }
    ]
  },
  {
    title: 'CLIENTS ET ABONNEMENTS',
    links: [
      { label: 'Abonnements', icon: 'repeat-outline' as const, href: '/subscriptions' as const, permission: 'subscriptions.read' },
      { label: 'Accès des clients', icon: 'qr-code-outline' as const, href: '/customers/access' as const, permission: 'customers.write' },
      { label: 'Alertes', icon: 'notifications-outline' as const, href: '/alerts' as const, permission: 'subscriptions.read' },
      { label: 'Statistiques', icon: 'stats-chart-outline' as const, href: '/stats' as const, permission: 'orders.read' }
    ]
  },
  {
    title: 'ADMINISTRATION',
    links: [
      { label: 'Formules', icon: 'pricetags-outline' as const, href: '/plans' as const, permission: 'subscriptions.read' },
      { label: 'Paramètres', icon: 'settings-outline' as const, href: '/settings' as const, permission: 'settings.business.write' },
      { label: 'Utilisateurs', icon: 'shield-checkmark-outline' as const, href: '/users' as const, permission: 'users.read' },
      { label: 'Journal d’activité', icon: 'reader-outline' as const, href: '/system/audit' as const, permission: 'audit.read' },
      { label: 'Permissions globales', icon: 'key-outline' as const, href: '/system/permissions' as const, permission: 'system.root.manage' },
      { label: 'Diagnostic système', icon: 'pulse-outline' as const, href: '/system/diagnostics' as const, permission: 'system.settings.write' }
    ]
  }
];

export default function MoreScreen() {
  const router = useRouter();
  const { member, hasPermission, signOut } = useAuth();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const logout = async () => {
    try {
      await signOut();
    } catch (error) {
      Alert.alert('Déconnexion impossible', getErrorMessage(error));
    }
  };

  // Une section sans lien visible pour ce membre n'est pas affichée
  const visibleSections = sections
    .map((section) => ({
      ...section,
      links: section.links.filter((item) => !item.permission || hasPermission(item.permission))
    }))
    .filter((section) => section.links.length > 0);

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
      {visibleSections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionLabel}>{section.title}</Text>
          <View style={styles.card}>
            {section.links.map((item, index) => (
              <View key={item.label}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <Pressable onPress={() => router.push(item.href)} style={styles.link}>
                  <View style={styles.linkIcon}><Ionicons color={colors.primary} name={item.icon} size={20} /></View>
                  <Text style={styles.linkText}>{item.label}</Text>
                  <Ionicons color={colors.muted} name="chevron-forward" size={20} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ))}
      <Pressable onPress={() => setLogoutConfirmOpen(true)} style={styles.logout}>
        <Ionicons color={colors.danger} name="log-out-outline" size={22} />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>
      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Se déconnecter"
        danger
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          void logout();
        }}
        title="Se déconnecter ?"
        visible={logoutConfirmOpen}
      />
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
  section: { gap: spacing.sm },
  sectionLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  linkIcon: { alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft },
  linkText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  // Trait fin, aligné sur le texte (marge = padding + icône + espace)
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: spacing.md + 36 + spacing.md },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  logoutText: { color: colors.danger, fontWeight: '700' }
});
