import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { getPermissionMatrix, setRolePermission } from '@/features/system/system.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

export default function PermissionsScreen() {
  const queryClient = useQueryClient();
  const matrix = useQuery({ queryKey: ['permission-matrix'], queryFn: getPermissionMatrix });
  const mutation = useMutation({
    mutationFn: ({ role, permission, enabled }: { role: 'admin' | 'manager' | 'staff'; permission: string; enabled: boolean }) =>
      setRolePermission(role, permission, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permission-matrix'] }),
    onError: (error) => Alert.alert('Modification impossible', getErrorMessage(error))
  });

  if (matrix.isLoading) return <LoadingView />;
  if (matrix.error || !matrix.data) return <ErrorView message={getErrorMessage(matrix.error)} onRetry={() => void matrix.refetch()} />;

  return (
    <Screen>
      <Text style={styles.intro}>Les permissions du rôle root sont immuables. Toute modification ci-dessous est auditée côté base.</Text>
      {matrix.data.permissions.map((permission) => (
        <View key={permission.id} style={styles.permission}>
          <Text style={styles.code}>{permission.code}</Text>
          <Text style={styles.description}>{permission.description}</Text>
          <View style={styles.roles}>
            {matrix.data.roles.map((role) => {
              const enabled = matrix.data.enabled.has(`${role.id}:${permission.id}`);
              return (
                <Pressable
                  key={role.id}
                  disabled={mutation.isPending}
                  onPress={() => mutation.mutate({ role: role.name, permission: permission.code, enabled: !enabled })}
                  style={[styles.role, enabled && styles.enabled]}
                >
                  <Text style={[styles.roleText, enabled && styles.enabledText]}>{role.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  permission: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  code: { color: colors.primaryDark, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 13 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  role: { borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  enabled: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { color: colors.muted, fontWeight: '700', textTransform: 'capitalize' },
  enabledText: { color: colors.surface }
});
