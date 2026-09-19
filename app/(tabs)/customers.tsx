import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppInput } from '@/components/ui/AppInput';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { listCustomers } from '@/features/customers/customers.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, shadows, spacing } from '@/theme/colors';

export default function CustomersScreen() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const customers = useQuery({ queryKey: ['customers', search], queryFn: () => listCustomers(search) });

  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <AppInput label="Rechercher" onChangeText={setSearch} placeholder="Nom ou téléphone" value={search} />
        </View>
        {hasPermission('customers.write') ? (
          <Pressable accessibilityLabel="Ajouter un client" onPress={() => router.push('/customers/new')} style={styles.addButton}>
            <Ionicons color={colors.surface} name="add" size={28} />
          </Pressable>
        ) : null}
      </View>
      {customers.isLoading ? (
        <LoadingView />
      ) : customers.error ? (
        <ErrorView message={getErrorMessage(customers.error)} onRetry={() => void customers.refetch()} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={customers.data}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyView message="Ajoutez le premier client de Your Food." title="Aucun client" />}
          onRefresh={() => void customers.refetch()}
          refreshing={customers.isRefetching}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/customers/[id]', params: { id: item.id } })}
              style={styles.customer}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.firstName[0]}{item.lastName[0]}</Text>
              </View>
              <View style={styles.customerBody}>
                <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
                <Text style={styles.detail}>{item.phone}</Text>
                <Text style={styles.detail}>{[item.residence, item.building, item.room].filter(Boolean).join(' · ') || 'Adresse non renseignée'}</Text>
              </View>
              <Ionicons color={colors.muted} name="chevron-forward" size={20} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.sm },
  search: { flex: 1 },
  addButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    ...shadows.soft
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  customer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    ...shadows.soft
  },
  avatar: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 18, backgroundColor: colors.primarySoft },
  avatarText: { color: colors.primary, fontWeight: '900' },
  customerBody: { flex: 1, gap: 2 },
  name: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 13 }
});
