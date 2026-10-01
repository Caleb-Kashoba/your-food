import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Card } from '@/components/ui/Card';
import { Chips } from '@/components/ui/Chips';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import type { MealCategory } from '@/features/client-area/client.service';
import {
  DishOnOpenMenuError,
  createDish,
  deleteDish,
  listCatalog,
  updateDish,
  type CatalogEntry
} from '@/features/menus/menus.service';
import { formatDayMonth, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const CATEGORIES: { value: MealCategory; label: string }[] = [
  { value: 'plat', label: 'Plats' },
  { value: 'accompagnement', label: 'Accompagnements' },
  { value: 'viande', label: 'Viandes' }
];

type Dialog =
  | { kind: 'delete'; item: CatalogEntry }
  | { kind: 'blocked'; item: CatalogEntry; date: string }
  | null;

function menuHint(item: CatalogEntry): string | null {
  const today = localDateKey();
  const next = item.next_menus.find((date) => date >= today);
  if (!next) return null;
  return next === today ? 'sur le menu d’aujourd’hui' : `sur le menu du ${formatDayMonth(next)}`;
}

export default function CatalogScreen() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('menus.write');
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: listCatalog });
  const [category, setCategory] = useState<MealCategory>('plat');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['catalog'] });
  const fail = (caught: unknown) => {
    setNotice(null);
    setError(getErrorMessage(caught));
  };

  const add = useMutation({
    mutationFn: () => createDish(category, name),
    onSuccess: async () => {
      setName('');
      setError(null);
      setNotice('Plat ajouté à la carte.');
      await refresh();
    },
    onError: fail
  });

  const change = useMutation({
    mutationFn: (params: { id: string; name?: string; active?: boolean }) => {
      const { id, ...changes } = params;
      return updateDish(id, changes);
    },
    onSuccess: async (result, params) => {
      setError(null);
      setEditing(null);
      setNotice(
        params.active === false && result.removed_menus.length > 0
          ? `Retiré de ${result.removed_menus.length} menu${result.removed_menus.length > 1 ? 's' : ''} à venir.`
          : params.active === false
            ? 'Plat désactivé.'
            : 'Plat enregistré.'
      );
      await refresh();
    },
    onError: fail
  });

  const remove = useMutation({
    mutationFn: (item: CatalogEntry) => deleteDish(item.id),
    onSuccess: async (result) => {
      setDialog(null);
      setError(null);
      setNotice(`Plat supprimé. Ta carte compte désormais ${result.remaining} plat${result.remaining > 1 ? 's' : ''}.`);
      await refresh();
    },
    onError: (caught, item) => {
      if (caught instanceof DishOnOpenMenuError) setDialog({ kind: 'blocked', item, date: caught.date });
      else {
        setDialog(null);
        fail(caught);
      }
    }
  });

  const items = (catalog.data ?? []).filter((item) => item.category === category);

  return (
    <Screen>
      <Text style={styles.title}>Ta carte, prête à servir.</Text>
      <Chips onChange={setCategory} options={CATEGORIES} value={category} />

      {canWrite ? (
        <Card style={styles.add}>
          <AppInput label="Nouveau plat" onChangeText={setName} placeholder="Ex. Poulet moambe" value={name} />
          <AppButton disabled={!name.trim()} label="Ajouter à la carte" loading={add.isPending} onPress={() => add.mutate()} />
        </Card>
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {catalog.isLoading ? <LoadingView /> : null}
      {catalog.error ? <ErrorView message={getErrorMessage(catalog.error)} onRetry={() => void catalog.refetch()} /> : null}
      {catalog.data && items.length === 0 ? <EmptyView message="Ajoute un plat dans cette catégorie." title="Rien ici" /> : null}

      {items.map((item) => {
        const hint = item.is_active ? menuHint(item) : 'désactivé';
        const isEditing = editing?.id === item.id;
        return (
          <Card key={item.id} style={styles.item}>
            {isEditing ? (
              <View style={styles.editRow}>
                <View style={styles.grow}>
                  <AppInput label="Nom du plat" onChangeText={(value) => setEditing({ id: item.id, name: value })} value={editing.name} />
                </View>
                <AppButton label="OK" loading={change.isPending} onPress={() => change.mutate({ id: item.id, name: editing.name })} />
              </View>
            ) : (
              <View style={styles.row}>
                <View style={styles.grow}>
                  <Text style={[styles.name, !item.is_active && styles.inactive]}>{item.name}</Text>
                  {hint ? <Text style={styles.hint}>{hint}</Text> : null}
                </View>
                {canWrite ? (
                  <>
                    <Pressable accessibilityLabel={`Modifier ${item.name}`} accessibilityRole="button" onPress={() => setEditing({ id: item.id, name: item.name })} style={styles.icon}>
                      <Ionicons color={colors.primary} name="pencil" size={20} />
                    </Pressable>
                    <Switch
                      accessibilityLabel={`Proposer ${item.name}`}
                      onValueChange={(active) => change.mutate({ id: item.id, active })}
                      thumbColor={colors.white}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={item.is_active}
                    />
                    <Pressable accessibilityLabel={`Supprimer ${item.name}`} accessibilityRole="button" onPress={() => setDialog({ kind: 'delete', item })} style={styles.icon}>
                      <Ionicons color={colors.danger} name="trash-outline" size={20} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            )}
          </Card>
        );
      })}

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Oui, supprimer"
        danger
        loading={remove.isPending}
        message="Les avis et l’historique des clients qui l’ont déjà mangé sont conservés."
        onCancel={() => setDialog(null)}
        onConfirm={() => dialog?.kind === 'delete' && remove.mutate(dialog.item)}
        title={dialog?.kind === 'delete' ? `Supprimer « ${dialog.item.name} » ?` : ''}
        visible={dialog?.kind === 'delete'}
      />
      <ConfirmModal
        cancelLabel="Fermer"
        confirmLabel="Désactiver le plat"
        message={
          dialog?.kind === 'blocked'
            ? `« ${dialog.item.name} » est proposé sur le menu du ${dialog.date ? formatDayMonth(dialog.date) : 'jour'}, qui n’est pas encore verrouillé. Désactive-le plutôt : il disparaîtra des prochains menus, sans être perdu.`
            : undefined
        }
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind === 'blocked') change.mutate({ id: dialog.item.id, active: false });
          setDialog(null);
        }}
        title="Suppression impossible"
        visible={dialog?.kind === 'blocked'}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
  add: { gap: spacing.md },
  notice: { color: colors.success, fontSize: 14, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  item: { paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  grow: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  inactive: { color: colors.muted },
  hint: { color: colors.accent, fontSize: 13, fontStyle: 'italic' },
  icon: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: radii.round, backgroundColor: colors.surface }
});
