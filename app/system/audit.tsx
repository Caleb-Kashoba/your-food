import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { Chips } from '@/components/ui/Chips';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import {
  ACTION_LABEL,
  ACTOR_LABEL,
  AREA_LABEL,
  PAGE_SIZE,
  describeRow,
  searchAudit,
  type ActorKind,
  type AuditAction,
  type AuditArea,
  type AuditFilters
} from '@/features/audit/audit.service';
import { addLocalDays, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, shadows, spacing } from '@/theme/colors';

type Period = 'today' | '7' | '30' | 'all';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: 'all', label: 'Tout' }
];

const FIELD_LABEL: Record<string, string> = {
  status: 'statut', admin_status: 'statut', applied_price: 'prix', amount: 'montant', phone: 'téléphone', whatsapp: 'WhatsApp',
  first_name: 'prénom', last_name: 'nom', name: 'nom', is_active: 'actif', deadline_time: 'heure limite', end_date: 'date de fin',
  start_date: 'date de début', plat_option_id: 'plat', accompagnement_option_id: 'accompagnement', viande_option_id: 'viande',
  cancellation_reason: 'raison d’annulation', notes: 'notes', is_default: 'choix par défaut', auth_user_id: 'compte'
};

const ACTOR_OPTIONS = (['equipe', 'client', 'systeme'] as ActorKind[]).map((value) => ({ value, label: ACTOR_LABEL[value] }));
const AREA_OPTIONS = (Object.keys(AREA_LABEL) as AuditArea[]).map((value) => ({ value, label: AREA_LABEL[value] }));
const ACTION_OPTIONS = (['cree', 'modifie', 'supprime'] as AuditAction[]).map((value) => ({ value, label: ACTION_LABEL[value] }));

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' }).format(new Date(iso));
}

/**
 * Journal d'activité. Les réglages courants sont en haut (recherche, période) ; les autres filtres (qui, sur quoi,
 * quelle action) sont dans une feuille « Filtres », et ceux qui sont actifs s'affichent en étiquettes retirables.
 */
export default function AuditScreen() {
  const [period, setPeriod] = useState<Period>('7');
  const [actor, setActor] = useState<ActorKind | null>(null);
  const [area, setArea] = useState<AuditArea | null>(null);
  const [action, setAction] = useState<AuditAction | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const today = localDateKey();
  const filters: AuditFilters = {
    ...(period === 'today' ? { from: today } : period === 'all' ? {} : { from: addLocalDays(today, -Number(period)) }),
    ...(actor ? { actorKind: actor } : {}),
    ...(area ? { area } : {}),
    ...(action ? { action } : {}),
    ...(query ? { q: query } : {})
  };

  const log = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => searchAudit(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * PAGE_SIZE < last.total ? pages.length : undefined)
  });

  const rows = log.data?.pages.flatMap((page) => page.rows) ?? [];
  const total = log.data?.pages[0]?.total ?? 0;

  const tags = [
    actor ? { key: 'actor', label: ACTOR_LABEL[actor], clear: () => setActor(null) } : null,
    area ? { key: 'area', label: AREA_LABEL[area], clear: () => setArea(null) } : null,
    action ? { key: 'action', label: ACTION_LABEL[action], clear: () => setAction(null) } : null
  ].filter((tag): tag is { key: string; label: string; clear: () => void } => tag !== null);

  const clearAll = () => {
    setActor(null);
    setArea(null);
    setAction(null);
  };

  return (
    <Screen>
      <Text style={styles.title}>Journal d’activité</Text>
      <Text style={styles.help}>Qui a fait quoi, et quand. Les actions des clients (commandes, avis) y figurent aussi.</Text>

      <View style={styles.bar}>
        <View style={styles.searchBox}>
          <Ionicons color={colors.muted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Rechercher dans le journal"
            onChangeText={setSearch}
            placeholder="Rechercher un nom, un plat…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            value={search}
          />
        </View>
        <Pressable accessibilityLabel="Filtres" accessibilityRole="button" onPress={() => setSheet(true)} style={[styles.filterButton, tags.length > 0 && styles.filterButtonOn]}>
          <Ionicons color={tags.length > 0 ? colors.white : colors.primary} name="options-outline" size={20} />
          <Text style={[styles.filterText, tags.length > 0 && styles.filterTextOn]}>Filtres{tags.length > 0 ? ` · ${tags.length}` : ''}</Text>
        </Pressable>
      </View>

      <Chips label="Période" onChange={setPeriod} options={PERIODS} value={period} />

      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Pressable accessibilityLabel={`Retirer le filtre ${tag.label}`} accessibilityRole="button" key={tag.key} onPress={tag.clear} style={styles.tag}>
              <Text style={styles.tagText}>{tag.label}</Text>
              <Ionicons color={colors.primaryDark} name="close" size={14} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={clearAll}><Text style={styles.clear}>Tout effacer</Text></Pressable>
        </View>
      ) : null}

      {log.isLoading ? <LoadingView /> : null}
      {log.error ? <ErrorView message={getErrorMessage(log.error)} onRetry={() => void log.refetch()} /> : null}
      {log.data ? <Text style={styles.count}>{total} événement{total > 1 ? 's' : ''}</Text> : null}
      {log.data && rows.length === 0 ? <EmptyView message="Essaie une autre période ou retire un filtre." title="Aucun événement" /> : null}

      {rows.map((row) => (
        <Card key={row.id} style={styles.row}>
          <View style={styles.rowTop}>
            <Text style={styles.actor}>{row.actor_name}</Text>
            <View style={[styles.kind, row.actor_kind === 'client' ? styles.kindClient : row.actor_kind === 'systeme' ? styles.kindSystem : styles.kindTeam]}>
              <Text style={styles.kindText}>{ACTOR_LABEL[row.actor_kind].replace('Clients', 'Client')}</Text>
            </View>
          </View>
          <Text style={styles.sentence}>{describeRow(row)}</Text>
          {row.changed_fields && row.changed_fields.length > 0 ? (
            <Text style={styles.fields}>Modifié : {row.changed_fields.map((field) => FIELD_LABEL[field] ?? field).join(', ')}</Text>
          ) : null}
          <Text style={styles.when}>{formatWhen(row.at)}</Text>
        </Card>
      ))}

      {log.hasNextPage ? <AppButton label="Voir plus" loading={log.isFetchingNextPage} onPress={() => void log.fetchNextPage()} variant="secondary" /> : null}

      <Modal animationType="slide" onRequestClose={() => setSheet(false)} transparent visible={sheet}>
        <Pressable onPress={() => setSheet(false)} style={styles.backdrop}>
          <Pressable onPress={() => undefined} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filtres</Text>
              <Pressable accessibilityLabel="Fermer" accessibilityRole="button" onPress={() => setSheet(false)}>
                <Ionicons color={colors.muted} name="close" size={26} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <ChipGroup onChange={setActor} options={ACTOR_OPTIONS} title="Qui" value={actor} />
              <ChipGroup onChange={setArea} options={AREA_OPTIONS} title="Sur quoi" value={area} />
              <ChipGroup onChange={setAction} options={ACTION_OPTIONS} title="Quelle action" value={action} />
            </ScrollView>
            <View style={styles.sheetActions}>
              <AppButton label={`Voir les résultats${log.data ? ` (${total})` : ''}`} onPress={() => setSheet(false)} />
              {tags.length > 0 ? <AppButton label="Tout effacer" onPress={clearAll} variant="ghost" /> : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minHeight: 48, color: colors.text, fontSize: 15 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, backgroundColor: colors.primarySoft, borderRadius: radii.round, paddingHorizontal: spacing.md },
  filterButtonOn: { backgroundColor: colors.primary },
  filterText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  filterTextOn: { color: colors.white },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: radii.round, paddingHorizontal: spacing.sm + 2, paddingVertical: 6 },
  tagText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  clear: { color: colors.muted, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  count: { color: colors.primaryDark, fontSize: 14, fontWeight: '800' },
  row: { gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  actor: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' },
  kind: { borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  kindTeam: { backgroundColor: colors.infoSoft },
  kindClient: { backgroundColor: colors.primarySoft },
  kindSystem: { backgroundColor: colors.divider },
  kindText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  sentence: { color: colors.text, fontSize: 14 },
  fields: { color: colors.muted, fontSize: 12 },
  when: { color: colors.muted, fontSize: 11 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(53, 23, 14, 0.45)' },
  sheet: { alignSelf: 'center', width: '100%', maxWidth: 560, maxHeight: '85%', backgroundColor: colors.surfaceStrong, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, gap: spacing.md, ...shadows.raised },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: colors.primaryDark, fontSize: 22, fontWeight: '900' },
  sheetBody: { gap: spacing.lg, paddingBottom: spacing.sm },
  sheetActions: { gap: spacing.xs }
});
