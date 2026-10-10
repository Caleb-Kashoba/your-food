import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { Chips } from '@/components/ui/Chips';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import type { MealCategory } from '@/features/client-area/client.service';
import { listCatalog, listMenuWeek, publishMenu, publishMenus, updateMenu } from '@/features/menus/menus.service';
import { addLocalDays, capitalizeFirst, formatDayChip, formatDayMonth, localDateKey, nextWorkingDay } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const CATEGORIES: { value: MealCategory; label: string }[] = [
  { value: 'plat', label: 'Plats' },
  { value: 'accompagnement', label: 'Accompagnements' },
  { value: 'viande', label: 'Viandes' }
];
// Plus d'heure limite pour le lancement : la valeur envoyée à la base est ignorée (la limite se réglera plus tard)
const NO_DEADLINE = '13:00';

/** Les 10 prochains jours ouvrés, aujourd'hui compris (un menu oublié peut encore être publié le jour même) */
function upcomingWorkingDays(from: string, count = 10): string[] {
  const days: string[] = [];
  let day = from;
  while (days.length < count) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) days.push(day);
    day = addLocalDays(day, 1);
  }
  return days;
}

/**
 * Publication d'un menu (un jour, ou le même menu sur plusieurs jours ouvrés) ou modification d'un menu à venir.
 * Un menu compte au moins un plat, un accompagnement et une viande, sans maximum par catégorie.
 */
export default function PublishMenuScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(params.date ?? nextWorkingDay(localDateKey()));
  const [days, setDays] = useState('1');
  // Choix de l'utilisatrice ; tant qu'elle n'a rien touché, on affiche ceux du menu existant
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [category, setCategory] = useState<MealCategory>('plat');
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery({ queryKey: ['catalog'], queryFn: listCatalog });
  const day = useQuery({ queryKey: ['menus', 'day', date], queryFn: async () => (await listMenuWeek(date, date))[0] ?? null, enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) });

  const existing = day.data?.published ? day.data : null;
  const chosen = selected ?? new Set(existing?.options.map((option) => option.item_id) ?? []);
  const count = Math.max(1, Number.parseInt(days, 10) || 1);

  const save = useMutation({
    mutationFn: async () => {
      const itemIds = [...chosen];
      if (existing) {
        await updateMenu(date, { itemIds });
        return 'Menu modifié.';
      }
      if (count > 1) {
        const result = await publishMenus(date, count, itemIds, NO_DEADLINE);
        return `${result.created.length} menu${result.created.length > 1 ? 's' : ''} publié${result.created.length > 1 ? 's' : ''}${result.ignored.length > 0 ? ` (${result.ignored.length} jour${result.ignored.length > 1 ? 's' : ''} déjà publié${result.ignored.length > 1 ? 's' : ''}, ignoré${result.ignored.length > 1 ? 's' : ''})` : ''}.`;
      }
      await publishMenu(date, itemIds, NO_DEADLINE);
      return 'Menu publié.';
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['menus'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
      if (router.canGoBack()) router.back();
      else router.replace('/menus');
    },
    onError: (caught) => setError(getErrorMessage(caught))
  });

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setError(null);
  };

  if (catalog.isLoading) return <LoadingView />;
  if (catalog.error || !catalog.data) return <ErrorView message={getErrorMessage(catalog.error)} onRetry={() => void catalog.refetch()} />;

  const active = catalog.data.filter((item) => item.is_active);
  const list = active.filter((item) => item.category === category);
  const countBy = (value: MealCategory) => active.filter((item) => item.category === value && chosen.has(item.id)).length;
  const complete = CATEGORIES.every((item) => countBy(item.value) > 0);

  return (
    <Screen>
      <Text style={styles.title}>{existing ? 'Modifier le menu' : 'Publier un menu'}</Text>

      {params.date ? (
        <Text style={styles.section}>{capitalizeFirst(formatDayMonth(date))}</Text>
      ) : (
        <Chips
          label="Jour du menu"
          onChange={(value) => { setDate(value); setSelected(null); setError(null); }}
          options={upcomingWorkingDays(localDateKey()).map((value) => ({ value, label: value === localDateKey() ? `Aujourd’hui (${formatDayChip(value)})` : formatDayChip(value) }))}
          value={date}
        />
      )}
      {existing ? <Text style={styles.help}>Un menu existe déjà ce jour : tu peux changer ses plats. Les repas par défaut des clients se mettent à jour.</Text> : null}
      {!existing ? (
        <AppInput keyboardType="number-pad" label="Nombre de jours ouvrés (même menu)" onChangeText={setDays} value={days} />
      ) : null}

      <Text style={styles.help}>À la publication, chaque client attendu reçoit un repas par défaut (le plus choisi) ; il peut le changer toute la journée de la veille.</Text>

      <Text style={styles.section}>Plats proposés</Text>
      <Chips onChange={setCategory} options={CATEGORIES.map((item) => ({ value: item.value, label: `${item.label} (${countBy(item.value)})` }))} value={category} />
      <View style={styles.list}>
        {list.length === 0 ? <Text style={styles.help}>Aucun plat actif dans cette catégorie : ajoute-en dans la carte.</Text> : null}
        {list.map((item) => {
          const on = chosen.has(item.id);
          return (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} key={item.id} onPress={() => toggle(item.id)} style={[styles.item, on && styles.itemOn]}>
              <Text style={[styles.itemText, on && styles.itemTextOn]}>{item.name}</Text>
              <Text style={styles.check}>{on ? '✓' : ''}</Text>
            </Pressable>
          );
        })}
      </View>

      {!complete ? <Text style={styles.help}>Un menu compte au moins un plat, un accompagnement et une viande.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <AppButton disabled={!complete} label={existing ? 'Enregistrer' : count > 1 ? `Publier sur ${count} jours` : 'Publier le menu'} loading={save.isPending} onPress={() => save.mutate()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  section: { color: colors.primaryDark, fontSize: 17, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  list: { gap: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md },
  itemOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  itemText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  itemTextOn: { color: colors.primaryDark, fontWeight: '800' },
  check: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' }
});
