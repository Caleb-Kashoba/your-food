import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews';
import { Stars } from '@/components/ui/Stars';
import { listReviews } from '@/features/orders/orders.service';
import { formatDayMonth } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme/colors';

/** Flux des avis laissés par les clients, du plus récent au plus ancien */
export default function ReviewsScreen() {
  const reviews = useQuery({ queryKey: ['orders', 'reviews'], queryFn: listReviews });

  return (
    <Screen>
      <Text style={styles.title}>Avis des clients</Text>
      {reviews.isLoading ? <LoadingView /> : null}
      {reviews.error ? <ErrorView message={getErrorMessage(reviews.error)} onRetry={() => void reviews.refetch()} /> : null}
      {reviews.data?.length === 0 ? <EmptyView message="Les avis laissés par les clients apparaîtront ici." title="Pas encore d’avis" /> : null}
      {reviews.data?.map((review) => (
        <Card key={review.review_id} style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.name}>{review.customer_name}</Text>
            <Text style={styles.date}>{formatDayMonth(review.date)}</Text>
          </View>
          {review.rating ? <Stars label="Note" size={20} value={review.rating} /> : null}
          {review.comment ? <Text style={styles.comment}>« {review.comment} »</Text> : null}
          <Text style={styles.meal}>{review.meal}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.primaryDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  date: { color: colors.muted, fontSize: 12 },
  comment: { color: colors.text, fontSize: 14, fontStyle: 'italic' },
  meal: { color: colors.muted, fontSize: 12 }
});
