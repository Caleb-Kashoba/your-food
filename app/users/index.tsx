import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { changeMemberRole, inviteTeamMember, listTeamMembers, setMemberStatus } from '@/features/users/users.service';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';
import type { AppRole } from '@/types/domain';

const roles: AppRole[] = ['root', 'admin', 'manager', 'staff'];
const roleLevels: Record<AppRole, number> = { root: 100, admin: 80, manager: 50, staff: 20 };

export default function UsersScreen() {
  const { member, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ['team-members'], queryFn: listTeamMembers });
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('staff');
  const [inviting, setInviting] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);

  const canAssign = (targetRole: AppRole, role: AppRole) => {
    if (member?.role === 'root') return true;
    if (!member) return false;
    return roleLevels[targetRole] < roleLevels[member.role] && roleLevels[role] < roleLevels[member.role];
  };

  const changeRole = async (targetId: string, targetRole: AppRole, role: AppRole) => {
    if (!canAssign(targetRole, role)) return;
    try {
      await changeMemberRole(targetId, role);
      await queryClient.invalidateQueries({ queryKey: ['team-members'] });
    } catch (error) {
      Alert.alert('Rôle non modifié', getErrorMessage(error));
    }
  };

  const canChangeStatus = (targetUserId: string, targetRole: AppRole) => {
    if (targetUserId === member?.userId || !hasPermission('users.update')) return false;
    return member?.role === 'root' || Boolean(member && roleLevels[targetRole] < roleLevels[member.role]);
  };

  const changeStatus = (targetId: string, displayName: string, status: 'active' | 'disabled') => {
    const nextStatus = status === 'active' ? 'disabled' : 'active';
    const actionLabel = nextStatus === 'disabled' ? 'Désactiver' : 'Réactiver';
    Alert.alert(
      `${actionLabel} ce compte ?`,
      `${displayName} ${nextStatus === 'disabled' ? "ne pourra plus accéder à l’application" : 'retrouvera son accès'}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: actionLabel,
          style: nextStatus === 'disabled' ? 'destructive' : 'default',
          onPress: () => {
            setUpdatingMemberId(targetId);
            void setMemberStatus(targetId, nextStatus)
              .then(() => queryClient.invalidateQueries({ queryKey: ['team-members'] }))
              .catch((error: unknown) => Alert.alert('Statut non modifié', getErrorMessage(error)))
              .finally(() => setUpdatingMemberId(null));
          }
        }
      ]
    );
  };

  const invite = async () => {
    if (!email.trim() || !displayName.trim()) return;
    try {
      setInviting(true);
      await inviteTeamMember(email, displayName, inviteRole);
      setEmail('');
      setDisplayName('');
      Alert.alert('Invitation envoyée', 'Le membre recevra un e-mail de Supabase Auth.');
      await queryClient.invalidateQueries({ queryKey: ['team-members'] });
    } catch (error) {
      Alert.alert('Invitation impossible', getErrorMessage(error));
    } finally {
      setInviting(false);
    }
  };

  if (team.isLoading) return <LoadingView />;
  if (team.error) return <ErrorView message={getErrorMessage(team.error)} onRetry={() => void team.refetch()} />;

  return (
    <Screen>
      {hasPermission('users.create') ? (
        <View style={styles.inviteCard}>
          <Text style={styles.title}>Inviter un membre</Text>
          <AppInput autoCapitalize="words" label="Nom affiché" onChangeText={setDisplayName} value={displayName} />
          <AppInput autoCapitalize="none" keyboardType="email-address" label="E-mail" onChangeText={setEmail} value={email} />
          <View style={styles.roles}>
            {roles.filter((role) => member?.role === 'root' || (member && roleLevels[role] < roleLevels[member.role])).map((role) => (
              <Pressable key={role} onPress={() => setInviteRole(role)} style={[styles.roleChip, inviteRole === role && styles.roleChipActive]}>
                <Text style={[styles.roleText, inviteRole === role && styles.roleTextActive]}>{role}</Text>
              </Pressable>
            ))}
          </View>
          <AppButton label="Envoyer l’invitation" loading={inviting} onPress={() => void invite()} />
        </View>
      ) : null}
      <Text style={styles.title}>Équipe</Text>
      {team.data?.length === 0 ? <EmptyView message="Invitez le premier membre de l’équipe." title="Aucun utilisateur" /> : null}
      {team.data?.map((item) => (
        <View key={item.id} style={styles.memberCard}>
          <View style={styles.memberHeader}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{item.displayName[0]}</Text></View>
            <View style={styles.grow}>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.meta}>{item.email}</Text>
              <Text style={styles.currentRole}>{item.role} · {item.status === 'active' ? 'actif' : 'désactivé'}</Text>
            </View>
          </View>
          {hasPermission('users.change_role') ? (
            <View style={styles.roles}>
              {roles.filter((role) => canAssign(item.role, role)).map((role) => (
                <Pressable
                  key={role}
                  disabled={item.role === role}
                  onPress={() => void changeRole(item.id, item.role, role)}
                  style={[styles.roleChip, item.role === role && styles.roleChipActive]}
                >
                  <Text style={[styles.roleText, item.role === role && styles.roleTextActive]}>{role}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {canChangeStatus(item.userId, item.role) ? (
            <AppButton
              label={item.status === 'active' ? 'Désactiver le compte' : 'Réactiver le compte'}
              loading={updatingMemberId === item.id}
              onPress={() => changeStatus(item.id, item.displayName, item.status)}
              variant={item.status === 'active' ? 'danger' : 'secondary'}
            />
          ) : null}
        </View>
      ))}
      <Text style={styles.securityNote}>
        Les règles critiques sont imposées par PostgreSQL : un admin ne peut pas modifier un root et le dernier root actif ne peut pas être désactivé ou rétrogradé.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inviteCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  title: { color: colors.primaryDark, fontSize: 18, fontWeight: '800' },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleChip: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { color: colors.muted, fontWeight: '700', textTransform: 'capitalize' },
  roleTextActive: { color: colors.surface },
  memberCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft },
  avatarText: { color: colors.primaryDark, fontWeight: '800' },
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  currentRole: { color: colors.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  securityNote: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', padding: spacing.md }
});
