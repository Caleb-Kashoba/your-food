import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { Stars } from '@/components/ui/Stars';
import { getHistory, submitReview, type HistoryEntry } from '@/features/client-area/client.service';
import { addLocalDays, capitalizeFirst, formatDayMonth, localDateKey } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

type Range = 'all' | '7' | '30';
const RANGES: { value: Range; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' }
];

export default function ClientHistoryScreen() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range>('all');

  // Recherche différée : pas d'appel à chaque lettre
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const from = range === 'all' ? undefined : addLocalDays(localDateKey(), -Number(range));
  const history = useQuery({
    queryKey: ['client', 'history', { query, range }],
    queryFn: () => getHistory({ ...(from ? { from } : {}), ...(query ? { q: query } : {}) })
  });

  return (
    <Screen>
      <Text style={styles.title}>Tes repas.</Text>
      <View style={styles.searchBox}>
        <Ionicons color={colors.muted} name="search" size={18} />
        <TextInput
          accessibilityLabel="Rechercher un plat"
          onChangeText={setSearch}
          placeholder="Rechercher un plat…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          value={search}
        />
      </View>
      <View style={styles.chips}>
        {RANGES.map((item) => (
          <Pressable accessibilityRole="button" key={item.value} onPress={() => setRange(item.value)} style={[styles.chip, range === item.value && styles.chipActive]}>
            <Text style={[styles.chipText, range === item.value && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {history.isLoading ? <LoadingView /> : null}
      {history.error ? <ErrorView message={getErrorMessage(history.error)} onRetry={() => void history.refetch()} /> : null}
      {history.data?.length === 0 ? (
        <EmptyView message={query || range !== 'all' ? 'Essaie un autre plat ou une autre période.' : 'Tes repas servis apparaîtront ici.'} title="Rien à afficher" />
      ) : null}
      {history.data?.map((entry) => <HistoryCard entry={entry} key={entry.order_id} />)}
    </Screen>
  );
}

function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => submitReview({ orderId: entry.order_id, ...(rating > 0 ? { rating } : {}), comment }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['client'] });
    },
    onError: (caught) => setError(getErrorMessage(caught))
  });

  const cancelled = entry.status === 'cancelled';
  const meal = [entry.plat, entry.accompagnement, entry.viande].filter(Boolean);

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.date}>{capitalizeFirst(formatDayMonth(entry.date))}</Text>
        <View style={[styles.tag, cancelled ? styles.tagCancelled : entry.is_default ? styles.tagDefault : styles.tagServed]}>
          <Text style={styles.tagText}>{cancelled ? 'annulé' : entry.is_default ? 'choisi pour toi' : 'servi'}</Text>
        </View>
      </View>
      {cancelled ? <Text style={styles.muted}>Pas de repas ce jour.</Text> : meal.map((line) => <Text key={line} style={styles.meal}>{line}</Text>)}
      {entry.rating ? <Stars label="Ta note" value={entry.rating} size={20} /> : null}
      {entry.comment ? <Text style={styles.comment}>« {entry.comment} »</Text> : null}
      {entry.review_possible && !open ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
          <Text style={styles.link}>Donner mon avis</Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.reviewBox}>
          <Stars onChange={setRating} value={rating} />
          <TextInput
            accessibilityLabel="Commentaire"
            maxLength={1000}
            onChangeText={setComment}
            placeholder="Ton commentaire (facultatif)"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={comment}
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <AppButton disabled={rating === 0 && !comment.trim()} label="Envoyer mon avis" loading={send.isPending} onPress={() => send.mutate()} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minHeight: 48, color: colors.text, fontSize: 15 },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: colors.white },
  card: { gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  tag: { borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  tagServed: { backgroundColor: colors.successSoft },
  tagDefault: { backgroundColor: colors.infoSoft },
  tagCancelled: { backgroundColor: colors.dangerSoft },
  tagText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  meal: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 14 },
  comment: { color: colors.muted, fontSize: 14, fontStyle: 'italic' },
  link: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  reviewBox: { gap: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  input: { minHeight: 48, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, color: colors.text, fontSize: 15, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  error: { color: colors.danger, fontSize: 13 }
});
