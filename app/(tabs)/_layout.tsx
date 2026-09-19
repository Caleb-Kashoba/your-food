import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors } from '@/theme/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.primaryDark, fontWeight: '900' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: colors.primarySoft,
        tabBarStyle: {
          backgroundColor: colors.surfaceStrong,
          borderTopColor: colors.border,
          height: 70,
          paddingHorizontal: 8,
          paddingBottom: 8,
          paddingTop: 7
        },
        tabBarItemStyle: { borderRadius: 16, marginHorizontal: 2 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '800' }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="home-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Abonnés',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="people-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: 'Aujourd’hui',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="calendar-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="finances"
        options={{
          title: 'Finances',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="wallet-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Plus',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="grid-outline" size={size} />
        }}
      />
    </Tabs>
  );
}
