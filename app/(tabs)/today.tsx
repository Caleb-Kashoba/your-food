import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chips } from '@/components/ui/Chips';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  addressText,
  bowlRange,
  filterBowls,
  groupBowls,
  sortBowls,
  type BowlFilter,
  type SortKey,
  countByStage,
  daysOf,
  mealParts,
  nextStatus,
  rowsOfDay,
  stageOf,
  totalsToPrepare,
  type BoardRow,
  type Stage
} from '@/features/deliveries/board';
import { BowlTools } from '@/features/deliveries/BowlTools';
import { listBoard, updateDeliveryStatus } from '@/features/deliveries/deliveries.service';
import { useTableRealtime } from '@/hooks/use-table-realtime';
import { addLocalDays, capitalizeFirst, formatDayChip, formatDayMonth, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, shadows, spacing } from '@/theme/colors';
import type { DeliveryStatus } from '@/types/domain';

/** « 1 prêt », « 3 prêts » */
function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

type Mode = 'preparation' | 'livraison';
type PrepFilter = 'a_faire' | 'pretes' | 'tous';
type DeliveryFilter = 'a_livrer' | 'livrees' | 'pas_pretes';

const realtimeKeys = [['deliveries'], ['dashboard'], ['orders']] as const;

const PREP_FILTERS: { value: PrepFilter; label: string }[] = [
  { value: 'a_faire', label: 'À préparer' },
  { value: 'pretes', label: 'Prêts' },
  { value: 'tous', label: 'Tous' }
];

const STAGE_LABEL: Record<Stage, { text: string; bg: string }> = {
  attente_choix: { text: 'pas encore choisi', bg: colors.warningSoft },
  a_preparer: { text: 'à préparer', bg: colors.primarySoft },
  prete: { text: 'prêt', bg: colors.infoSoft },
  livree: { text: 'livré', bg: colors.successSoft },
  annulee: { text: 'annulé', bg: colors.dangerSoft }
};

/**
 * « Aujourd'hui » : deux parties pour la journée choisie.
 * - Préparation : les bols numérotés et regroupés par plat (numéros donnés au verrouillage du menu, à minuit), avec le total à préparer ;
 * - Livraison : les bols prêts, à livrer, avec l'adresse du client.
 * La vue se règle aussi sur les jours suivants, pour préparer à l'avance.
 */
export default function TodayScreen() {
  const { member, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const today = localDateKey();
  const [day, setDay] = useState(today);
  const [mode, setMode] = useState<Mode>('preparation');
  const [prepFilter, setPrepFilter] = useState<PrepFilter>('a_faire');
  // Contenu des bols : tri et filtres communs à la préparation et à la livraison
  const [sort, setSort] = useState<SortKey>('bol');
  const [contentFilter, setContentFilter] = useState<BowlFilter>({});
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('a_livrer');

  const board = useQuery({
    queryKey: ['deliveries', 'board', today],
    queryFn: () => listBoard(today, addLocalDays(today, 6)),
    refetchInterval: 30_000
  });
  useTableRealtime('deliveries', member?.organizationId, realtimeKeys);

  const change = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeliveryStatus }) => updateDeliveryStatus(id, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      ]);
    },
    onError: (error) => Alert.alert('Mise à jour impossible', getErrorMessage(error))
  });

  if (board.isLoading) return <LoadingView label="Chargement des livraisons…" />;
  if (board.error || !board.data) return <ErrorView message={getErrorMessage(board.error)} onRetry={() => void board.refetch()} />;

  const all = board.data;
  const days = daysOf(all);
  // Si aujourd'hui n'a aucune livraison, on commence au premier jour qui en a
  const selected = days.includes(day) ? day : days[0] ?? today;
  const rows = rowsOfDay(all, selected);
  const counts = countByStage(rows);
  const canAct = hasPermission('deliveries.update');
  const total = rows.length - counts.annulee;

  const dayOptions = days.map((value) => ({
    value,
    label: `${value === today ? 'Aujourd’hui' : formatDayChip(value)} · ${rowsOfDay(all, value).filter((row) => stageOf(row) !== 'annulee').length}`
  }));

  const act = (row: BoardRow) => {
    const next = nextStatus(row, mode);
    if (next) change.mutate({ id: row.delivery_id, status: next.status });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.page}
      refreshControl={<RefreshControl onRefresh={() => void board.refetch()} refreshing={board.isRefetching} tintColor={colors.primary} />}
    >
      <Chips onChange={setDay} options={dayOptions} value={selected} />

      <View style={styles.switch}>
        {([['preparation', 'Préparation', 'restaurant-outline'], ['livraison', 'Livraison', 'bicycle-outline']] as const).map(([value, label, icon]) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === value }} key={value} onPress={() => setMode(value)} style={[styles.switchButton, mode === value && styles.switchActive]}>
            <Ionicons color={mode === value ? colors.white : colors.muted} name={icon} size={18} />
            <Text style={[styles.switchText, mode === value && styles.switchTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryDate}>{capitalizeFirst(formatDayMonth(selected))}</Text>
        {mode === 'preparation' ? (
          <>
            <Text style={styles.summaryTotal}>{counts.a_preparer + counts.prete + counts.livree} à préparer</Text>
            <Text style={styles.summaryMeta}>
              {plural(counts.prete + counts.livree, 'prêt')} · {plural(counts.a_preparer, 'restant')}
              {counts.attente_choix > 0 ? ` · ${plural(counts.attente_choix, 'pas encore choisi')}` : ''}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.summaryTotal}>{counts.prete} à livrer</Text>
            <Text style={styles.summaryMeta}>{plural(counts.livree, 'livré')} · {plural(counts.a_preparer + counts.attente_choix, 'pas encore prêt')}</Text>
          </>
        )}
        {total === 0 ? <Text style={styles.summaryMeta}>Aucune livraison ce jour.</Text> : null}
      </View>

      {mode === 'preparation' ? (
        <PreparationPart
          canAct={canAct}
          contentFilter={contentFilter}
          onContentFilter={setContentFilter}
          onSort={setSort}
          sort={sort}
          filter={prepFilter}
          onAct={act}
          onFilter={setPrepFilter}
          pending={change.isPending}
          rows={rows}
        />
      ) : (
        <DeliveryPart
          canAct={canAct}
          contentFilter={contentFilter}
          onContentFilter={setContentFilter}
          onSort={setSort}
          sort={sort}
          filter={deliveryFilter}
          onAct={act}
          onFilter={setDeliveryFilter}
          pending={change.isPending}
          rows={rows}
        />
      )}
    </ScrollView>
  );
}

function PreparationPart({ rows, filter, onFilter, onAct, canAct, pending, sort, onSort, contentFilter, onContentFilter }: {
  rows: BoardRow[]; filter: PrepFilter; onFilter: (value: PrepFilter) => void; onAct: (row: BoardRow) => void; canAct: boolean; pending: boolean;
  sort: SortKey; onSort: (value: SortKey) => void; contentFilter: BowlFilter; onContentFilter: (value: BowlFilter) => void;
}) {
  const totals = totalsToPrepare(rows);
  const waiting = rows.filter((row) => stageOf(row) === 'attente_choix');
  const visible = rows.filter((row) => {
    const stage = stageOf(row);
    if (filter === 'a_faire') return stage === 'a_preparer' || stage === 'attente_choix';
    if (filter === 'pretes') return stage === 'prete' || stage === 'livree';
    return true;
  });
  const shownRows = filterBowls(visible, contentFilter);
  const groups = groupBowls(shownRows, sort);
  const numbered = rows.some((row) => row.bowl_number != null);
  const menuOpen = rows.some((row) => row.menu_status === 'open');

  return (
    <>
      {totals.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Total à préparer</Text>
          {totals.map((entry) => (
            <View key={`${entry.category}-${entry.name}`} style={styles.totalRow}>
              <Text style={styles.totalCount}>{entry.count} ×</Text>
              <Text style={styles.totalName}>{entry.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {waiting.length > 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {waiting.length} client{waiting.length > 1 ? 's n’ont' : ' n’a'} pas encore de repas : le repas par défaut arrive dans la minute s’il y a un menu, sinon saisis-le dans « Commandes du jour ».
          </Text>
        </View>
      ) : null}

      {!numbered && menuOpen ? (
        <Text style={styles.hint}>Les bols seront numérotés au verrouillage du menu (minuit). Tu peux déjà les trier et les filtrer.</Text>
      ) : null}
      <Chips onChange={onFilter} options={PREP_FILTERS} value={filter} />
      <BowlTools filter={contentFilter} onFilter={onContentFilter} onSort={onSort} rows={visible} sort={sort} />
      {shownRows.length === 0 ? <Text style={styles.empty}>Rien à afficher avec ces filtres.</Text> : null}
      {groups.map((group) => (
        <View key={group.title ?? 'tous'} style={styles.group}>
          {group.title ? (
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <Text style={styles.groupMeta}>
              {group.rows.length} bol{group.rows.length > 1 ? 's' : ''}{bowlRange(group.rows) ? ` · ${bowlRange(group.rows)}` : ''}
            </Text>
          </View>
          ) : null}
          {group.rows.map((row) => (
            <MealCard canAct={canAct} key={row.delivery_id} mode="preparation" onAct={() => onAct(row)} pending={pending} row={row} />
          ))}
        </View>
      ))}
    </>
  );
}

function DeliveryPart({ rows, filter, onFilter, onAct, canAct, pending, sort, onSort, contentFilter, onContentFilter }: {
  rows: BoardRow[]; filter: DeliveryFilter; onFilter: (value: DeliveryFilter) => void; onAct: (row: BoardRow) => void; canAct: boolean; pending: boolean;
  sort: SortKey; onSort: (value: SortKey) => void; contentFilter: BowlFilter; onContentFilter: (value: BowlFilter) => void;
}) {
  const counts = countByStage(rows);
  const options: { value: DeliveryFilter; label: string }[] = [
    { value: 'a_livrer', label: `À livrer · ${counts.prete}` },
    { value: 'livrees', label: `Livrés · ${counts.livree}` },
    { value: 'pas_pretes', label: `Pas encore prêts · ${counts.a_preparer + counts.attente_choix}` }
  ];
  const stageRows = rows.filter((row) => {
    const stage = stageOf(row);
    if (filter === 'a_livrer') return stage === 'prete';
    if (filter === 'livrees') return stage === 'livree';
    return stage === 'a_preparer' || stage === 'attente_choix';
  });

  const visible = sortBowls(filterBowls(stageRows, contentFilter), sort);

  return (
    <>
      <Chips onChange={onFilter} options={options} value={filter} />
      <BowlTools filter={contentFilter} onFilter={onContentFilter} onSort={onSort} rows={stageRows} sort={sort} />
      {visible.length === 0 ? (
        <Text style={styles.empty}>
          {filter === 'a_livrer' && stageRows.length === 0 ? 'Aucun repas prêt à livrer pour le moment : prépare les bols dans l’onglet Préparation.' : 'Rien à afficher avec ces filtres.'}
        </Text>
      ) : null}
      {visible.map((row) => (
        <MealCard canAct={canAct} key={row.delivery_id} mode="livraison" onAct={() => onAct(row)} pending={pending} row={row} />
      ))}
    </>
  );
}

function MealCard({ row, mode, canAct, pending, onAct }: { row: BoardRow; mode: Mode; canAct: boolean; pending: boolean; onAct: () => void }) {
  const stage = stageOf(row);
  const label = STAGE_LABEL[stage];
  const next = canAct ? nextStatus(row, mode) : null;
  const parts = mealParts(row);
  const address = addressText(row);
  const undo = next !== null && (next.status === 'scheduled' || (mode === 'livraison' && stage === 'livree'));

  return (
    <View style={[styles.meal, stage === 'annulee' && styles.mealDim]}>
      <View style={styles.mealHeader}>
        {row.bowl_number != null ? (
          <View accessibilityLabel={`Bol numéro ${row.bowl_number}`} style={styles.bowlNumber}>
            <Text style={styles.bowlNumberLabel}>BOL</Text>
            <Text style={styles.bowlNumberValue}>{row.bowl_number}</Text>
          </View>
        ) : null}
        <View style={styles.mealTitle}>
          <Text style={styles.name}>{row.customer_name}</Text>
          <Text style={styles.meta}>{row.plan_name}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: label.bg }]}><Text style={styles.pillText}>{label.text}</Text></View>
      </View>

      {parts.length > 0 ? (
        <View style={styles.bowl}>
          {parts.map((part, index) => (
            <Text key={`${part}-${index}`} style={[styles.bowlLine, index === 0 && styles.bowlMain]}>{part}</Text>
          ))}
          {row.state === 'defaut' ? <Text style={styles.defaultTag}>choisi par défaut</Text> : null}
        </View>
      ) : (
        <Text style={styles.meta}>
          {stage === 'annulee' ? 'Repas annulé par le client.' : 'Le client n’a pas encore choisi son repas.'}
        </Text>
      )}

      {mode === 'livraison' ? (
        <View style={styles.delivery}>
          {address ? <Text style={styles.meta}>{address}</Text> : <Text style={styles.meta}>Adresse non renseignée</Text>}
          <Text style={styles.meta}>{row.phone ?? 'Pas de numéro'}</Text>
        </View>
      ) : null}

      {next ? (
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={onAct}
          style={[styles.action, undo ? styles.actionQuiet : mode === 'livraison' ? styles.actionDeliver : styles.actionPrepare]}
        >
          <Text style={[styles.actionText, undo && styles.actionTextQuiet]}>{next.label}</Text>
        </Pressable>
      ) : mode === 'livraison' && (stage === 'a_preparer' || stage === 'attente_choix') ? (
        <Text style={styles.hint}>Pas encore prêt : à préparer d’abord.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  switch: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, padding: spacing.xs },
  switchButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.round, paddingVertical: spacing.sm + 2 },
  switchActive: { backgroundColor: colors.primary },
  switchText: { color: colors.muted, fontSize: 15, fontWeight: '800' },
  switchTextActive: { color: colors.white },
  summary: { backgroundColor: colors.primaryDark, borderRadius: radii.lg, gap: 2, padding: spacing.lg, ...shadows.soft },
  summaryDate: { color: colors.sand, fontSize: 13, fontWeight: '700' },
  summaryTotal: { color: colors.white, fontSize: 30, fontWeight: '900' },
  summaryMeta: { color: colors.sand, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: spacing.sm, padding: spacing.md },
  cardTitle: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  totalCount: { color: colors.primary, fontSize: 16, fontWeight: '900', minWidth: 36 },
  totalName: { flex: 1, color: colors.text, fontSize: 15 },
  notice: { backgroundColor: colors.warningSoft, borderRadius: radii.md, padding: spacing.md },
  noticeText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: spacing.lg },
  meal: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: spacing.sm, padding: spacing.md, ...shadows.soft },
  mealDim: { opacity: 0.6 },
  mealHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  mealTitle: { flex: 1 },
  name: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  pill: { borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  pillText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  bowl: { backgroundColor: colors.cream, borderRadius: radii.md, gap: 2, padding: spacing.md },
  bowlLine: { color: colors.text, fontSize: 15 },
  bowlMain: { fontWeight: '800' },
  defaultTag: { color: colors.info, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  delivery: { gap: 2 },
  action: { alignItems: 'center', borderRadius: radii.md, padding: spacing.md },
  actionPrepare: { backgroundColor: colors.primary },
  actionDeliver: { backgroundColor: colors.accent },
  actionQuiet: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  actionText: { color: colors.white, fontWeight: '900' },
  actionTextQuiet: { color: colors.muted },
  hint: { color: colors.muted, fontSize: 13, fontStyle: 'italic' },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1, paddingBottom: spacing.xs, marginTop: spacing.sm },
  groupTitle: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  groupMeta: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  bowlNumber: { alignItems: 'center', justifyContent: 'center', minWidth: 52, borderRadius: radii.md, backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  bowlNumberLabel: { color: colors.white, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  bowlNumberValue: { color: colors.white, fontSize: 22, fontWeight: '900', lineHeight: 26 }
});
