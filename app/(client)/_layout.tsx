import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';

import { getHistory, getTodayMenu } from '@/features/client-area/client.service';
import { colors } from '@/theme/colors';

/** Espace du client connecté : Menu, Historique, Compte (pastilles : choix à faire, avis à donner) */
export default function ClientTabsLayout() {
  const menu = useQuery({ queryKey: ['client', 'menu'], queryFn: getTodayMenu, refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ['client', 'history', 'all'], queryFn: () => getHistory() });

  const choicePending = Boolean(
    menu.data?.menu && ['normal', 'en_retard'].includes(menu.data.menu_status) && !menu.data.order &&
      ['actif', 'bientot_expire'].includes(menu.data.subscription.state)
  );
  const reviewsPending = history.data?.filter((entry) => entry.review_possible).length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: colors.primarySoft,
        tabBarStyle: { backgroundColor: colors.surfaceStrong, borderTopColor: colors.border, height: 70, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 7 },
        tabBarItemStyle: { borderRadius: 16, marginHorizontal: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800' },
        tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.white }
      }}
    >
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          ...(choicePending ? { tabBarBadge: 1 } : {}),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="restaurant-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="historique"
        options={{
          title: 'Historique',
          ...(reviewsPending > 0 ? { tabBarBadge: reviewsPending } : {}),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="time-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="compte"
        options={{
          title: 'Compte',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="person-outline" size={size} />
        }}
      />
    </Tabs>
  );
}
