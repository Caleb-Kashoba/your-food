import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
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
import { colors, radii, spacing } from '@/theme/colors';

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
  const date = new Date(iso);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' }).format(date);
}

/** Journal d'activité : filtres par période, auteur, domaine et type d'action, plus une recherche libre */
export default function AuditScreen() {
  const [period, setPeriod] = useState<Period>('7');
  const [actor, setActor] = useState<ActorKind | null>(null);
  const [area, setArea] = useState<AuditArea | null>(null);
  const [action, setAction] = useState<AuditAction | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

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

  // Toggle : retoucher la pastille active la désactive
  const toggle = <T extends string>(current: T | null, set: (value: T | null) => void) => (value: T) => set(current === value ? null : value);

  return (
    <Screen>
      <Text style={styles.title}>Journal d’activité</Text>
      <Text style={styles.help}>Qui a fait quoi, et quand. Les actions des clients (commandes, avis) y figurent aussi.</Text>

      <Text style={styles.label}>Période</Text>
      <Chips onChange={setPeriod} options={PERIODS} value={period} />
      <Text style={styles.label}>Qui</Text>
      <Chips onChange={toggle(actor, setActor)} options={ACTOR_OPTIONS} value={actor} />
      <Text style={styles.label}>Sur quoi</Text>
      <Chips onChange={toggle(area, setArea)} options={AREA_OPTIONS} value={area} />
      <Text style={styles.label}>Quelle action</Text>
      <Chips onChange={toggle(action, setAction)} options={ACTION_OPTIONS} value={action} />
      <TextInput
        accessibilityLabel="Rechercher dans le journal"
        onChangeText={setSearch}
        placeholder="Rechercher un nom, un plat…"
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={search}
      />

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  label: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: spacing.xs },
  search: { minHeight: 48, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, backgroundColor: colors.surfaceStrong, color: colors.text, fontSize: 15, paddingHorizontal: spacing.md },
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
  when: { color: colors.muted, fontSize: 11 }
});
