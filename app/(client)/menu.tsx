import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { AppButton } from '@/components/ui/AppButton';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { Stars } from '@/components/ui/Stars';
import {
  cancelOrder,
  getTodayMenu,
  submitOrder,
  submitReview,
  type MealCategory,
  type MenuOption,
  type TodayMeal,
  type TodayMenu
} from '@/features/client-area/client.service';
import {
  HEADLINES,
  deriveMenuState,
  formatCountdown,
  isComplete,
  isEditable,
  picksChanged,
  picksFromOrder,
  requiredCategories,
  secondsLeft,
  type ClientMenuState,
  type Picks
} from '@/features/client-area/menu-state';
import { formatDayMonth, formatLocalDate } from '@/lib/dates';
import { getErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme/colors';

const CATEGORY_TITLE: Record<MealCategory, string> = { plat: 'Plat', accompagnement: 'Accompagnement', viande: 'Viande' };

const NOTICES: Partial<Record<ClientMenuState, { title: string; text: string; tone: 'info' | 'success' | 'danger' | 'warning' }>> = {
  en_retard: { title: 'En retard', text: 'Tu peux encore choisir jusqu’à 20h00.', tone: 'warning' },
  verrouille: { title: 'Menu verrouillé', text: 'Ta commande est prise en compte.', tone: 'success' },
  defaut: { title: 'Attribué automatiquement', text: 'Aucun choix reçu : on t’a servi les plats les plus demandés.', tone: 'info' },
  annule: { title: 'Commande annulée', text: 'Ton repas est exclu de la préparation.', tone: 'danger' },
  inactif: { title: 'Abonnement en pause', text: 'Contacte l’administratrice pour reprendre tes repas.', tone: 'warning' },
  premier_jour: { title: 'Ton premier repas', text: 'Ton abonnement commence demain : on choisit ton premier repas pour toi. Ensuite, tu choisis la veille, avant 20h00.', tone: 'info' }
};

const DELIVERY_LABEL: Record<TodayMeal['delivery_status'], string> = {
  scheduled: 'en préparation',
  preparing: 'en préparation',
  ready: 'prêt, bientôt livré',
  out_for_delivery: 'en route',
  delivered: 'livré',
  failed: 'livraison manquée',
  cancelled: 'annulé'
};

/** Jour avant une date « AAAA-MM-JJ » (le jour où l'on commande) */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export default function ClientMenuScreen() {
  const queryClient = useQueryClient();
  const menuQuery = useQuery({ queryKey: ['client', 'menu'], queryFn: getTodayMenu, refetchInterval: 60_000 });
  const data = menuQuery.data;

  // Choix en cours de modification, rattachés à la commande enregistrée (réinitialisés quand elle change)
  const [edit, setEdit] = useState<{ signature: string; picks: Picks } | null>(null);
  const [resuming, setResuming] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const signature = data?.order ? `${data.order.id}-${data.order.updated_at}` : 'aucune';
  const picks: Picks = data ? (edit?.signature === signature ? edit.picks : picksFromOrder(data)) : {};
  const setPicks = (next: Picks) => setEdit({ signature, picks: next });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['client'] });

  const order = useMutation({
    mutationFn: (menu: TodayMenu) =>
      submitOrder({
        menuId: menu.menu!.id,
        plat: picks.plat!,
        accompagnement: picks.accompagnement!,
        viande: requiredCategories(menu).includes('viande') ? picks.viande! : null
      }),
    onSuccess: async () => {
      setResuming(false);
      setError(null);
      setFeedback('C’est noté, bon appétit !');
      await refresh();
    },
    onError: (caught) => {
      setFeedback(null);
      setError(getErrorMessage(caught));
      void refresh();
    }
  });

  const cancel = useMutation({
    mutationFn: (menuId: string) => cancelOrder(menuId),
    onSuccess: async () => {
      setConfirmCancel(false);
      setResuming(false);
      setError(null);
      setFeedback('Repas annulé pour demain.');
      await refresh();
    },
    onError: (caught) => {
      setConfirmCancel(false);
      setError(getErrorMessage(caught));
    }
  });

  if (menuQuery.isLoading) return <LoadingView label="Ouverture du menu…" />;
  if (menuQuery.error || !data) return <ErrorView message={getErrorMessage(menuQuery.error)} onRetry={() => void menuQuery.refetch()} />;

  const state = deriveMenuState(data, resuming);
  const editable = isEditable(state);
  const required = requiredCategories(data);
  const options = data.menu?.options ?? [];
  const hasActiveOrder = data.order?.status === 'confirmed';
  const complete = isComplete(data, picks);
  const unchanged = hasActiveOrder && !data.order?.is_default && !picksChanged(data, picks);
  const left = secondsLeft(data, state, now, data.device_offset_ms);
  const notice = NOTICES[state];
  const showChoices = !['aucun_menu', 'non_commence', 'expire', 'inactif', 'premier_jour'].includes(state);

  const pick = (category: MealCategory, optionId: string) => {
    if (!editable) return;
    setFeedback(null);
    setError(null);
    setPicks({ ...picks, [category]: optionId });
  };

  return (
    <Screen>
      <View style={styles.top}>
        <BrandLogo compact />
        {data.subscription.plan_name ? <View style={styles.plan}><Text style={styles.planText}>{data.subscription.plan_name}</Text></View> : null}
      </View>

      <View style={styles.heading}>
        <Text style={styles.date}>{state === 'aucun_menu' ? 'Demain' : 'Au menu demain'}, {formatDayMonth(data.date)}.</Text>
        <Text style={styles.headline}>{HEADLINES[state]}</Text>
      </View>

      {data.today_meal ? <TodayMealCard meal={data.today_meal} /> : null}

      {showChoices && data.menu && data.menu.lock_time ? (
        <Card style={styles.countdown}>
          <Ionicons color={state === 'en_retard' ? colors.danger : colors.primary} name="time-outline" size={22} />
          <View style={styles.grow}>
            <Text accessibilityRole="timer" style={[styles.timer, state === 'en_retard' && styles.timerLate]}>
              {editable ? formatCountdown(left) : '--:--:--'}
            </Text>
            <Text style={styles.timerLabel}>
              {state === 'annule' ? 'annulé' : editable ? 'avant la fin des commandes' : 'commande close'}
            </Text>
          </View>
        </Card>
      ) : null}

      {data.subscription.state === 'bientot_expire' && data.subscription.end_date ? (
        <Banner
          text={`Ton abonnement se termine le ${formatLocalDate(data.subscription.end_date)} (${data.subscription.working_days_left ?? 0} jours ouvrés). Pense à te réabonner.`}
          title="Bientôt la fin"
          tone="warning"
        />
      ) : null}
      {state === 'expire' ? (
        <Banner
          text={`Terminé le ${data.subscription.end_date ? formatLocalDate(data.subscription.end_date) : '—'}. Contacte l’administratrice pour le renouveler.`}
          title="Abonnement expiré"
          tone="danger"
        />
      ) : null}
      {state === 'non_commence' && data.subscription.start_date ? (
        <Banner text={`Ton abonnement commence le ${formatLocalDate(data.subscription.start_date)}. Reviens ce jour-là, on t’attend à table.`} title="Encore un peu de patience" tone="info" />
      ) : null}
      {state === 'aucun_menu' ? (
        <Banner
          text={data.next_menu_date
            ? `Le prochain menu est celui de ${formatDayMonth(data.next_menu_date)} : tu le choisis ${formatDayMonth(dayBefore(data.next_menu_date))}, avant 20h00.`
            : 'L’administratrice n’a pas encore publié le menu de demain. Reviens un peu plus tard.'}
          title="Pas de menu demain"
          tone="info"
        />
      ) : null}
      {editable && data.order?.is_default ? (
        <Banner text="On t’a déjà réservé le repas le plus choisi par les autres. Garde-le en le confirmant, ou change-le quand tu veux." title="Choisi pour toi" tone="info" />
      ) : null}
      {notice ? <Banner text={notice.text} title={notice.title} tone={notice.tone} /> : null}

      {showChoices && state !== 'annule'
        ? (['plat', 'accompagnement', 'viande'] as MealCategory[]).map((category) => {
            const list = options.filter((option) => option.category === category);
            if (list.length === 0) return null;
            const off = category === 'viande' && !required.includes('viande');
            return (
              <View key={category} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{CATEGORY_TITLE[category]}</Text>
                  <Text style={styles.sectionTag}>
                    {off ? 'pas demain' : !editable ? (state === 'defaut' ? 'choisi pour toi' : 'noté') : picks[category] ? 'choisi' : 'à toi de choisir'}
                  </Text>
                </View>
                {off ? (
                  <>
                    <Text style={styles.offNote}>
                      {data.subscription.plan_name ? `Ta ${data.subscription.plan_name} ne comprend pas de viande demain.` : 'Pas de viande au menu demain.'}
                    </Text>
                    <View style={styles.upsell}>
                      <Ionicons color={colors.muted} name="lock-closed-outline" size={16} />
                      <Text style={styles.upsellText}>Viande incluse en Formule 2</Text>
                    </View>
                  </>
                ) : (
                  list.map((option) => (
                    <OptionRow
                      disabled={!editable}
                      key={option.option_id}
                      onPress={() => pick(category, option.option_id)}
                      option={option}
                      selected={picks[category] === option.option_id}
                    />
                  ))
                )}
              </View>
            );
          })
        : null}

      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {showChoices ? (
        <View style={styles.actions}>
          {editable ? (
            unchanged ? (
              <AppButton disabled label="Repas confirmé" variant="secondary" />
            ) : (
              <AppButton
                disabled={!complete}
                label={hasActiveOrder && !data.order?.is_default ? 'Modifier mon repas' : 'Confirmer mon repas'}
                loading={order.isPending}
                onPress={() => order.mutate(data)}
              />
            )
          ) : (
            <AppButton disabled label={state === 'annule' ? 'Repas annulé' : 'Bon appétit'} variant="secondary" />
          )}
          {editable ? <AppButton label="Annuler mon repas" onPress={() => setConfirmCancel(true)} variant="ghost" /> : null}
          {state === 'annule' && data.menu_status !== 'verrouille' ? (
            <AppButton
              label="Finalement, je mange"
              onPress={() => {
                setResuming(true);
                setPicks({});
                setFeedback(null);
              }}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}

      {data.review_due ? <ReviewCard date={data.review_due.date} onSent={refresh} orderId={data.review_due.order_id} /> : null}

      <ConfirmModal
        cancelLabel="Garder mon repas"
        confirmLabel="Oui, pas de repas demain"
        danger
        loading={cancel.isPending}
        message="Tu ne seras pas livré demain. Tu peux changer d’avis plus tard dans la journée."
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => data.menu && cancel.mutate(data.menu.id)}
        title="Annuler ton repas ?"
        visible={confirmCancel}
      />
    </Screen>
  );
}

function TodayMealCard({ meal }: { meal: TodayMeal }) {
  const status = meal.cancelled ? 'annulé' : DELIVERY_LABEL[meal.delivery_status];
  const lines = [meal.plat, meal.accompagnement, meal.viande].filter(Boolean);
  return (
    <Card style={styles.today}>
      <View style={styles.todayHead}>
        <Text style={styles.todayTitle}>Ton repas d’aujourd’hui</Text>
        <Text style={styles.todayStatus}>{status}</Text>
      </View>
      {meal.cancelled ? (
        <Text style={styles.todayText}>Tu n’es pas livré aujourd’hui.</Text>
      ) : (
        <Text style={styles.todayText}>{lines.length ? lines.join(' · ') : 'En cours de préparation'}{meal.is_default ? ' (choisi pour toi)' : ''}</Text>
      )}
    </Card>
  );
}

function OptionRow({ option, selected, disabled, onPress }: { option: MenuOption; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected, disabled && !selected && styles.optionDim]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.name}</Text>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Ionicons color={colors.white} name="checkmark" size={14} /> : null}
      </View>
    </Pressable>
  );
}

function Banner({ title, text, tone }: { title: string; text: string; tone: 'info' | 'success' | 'danger' | 'warning' }) {
  const palette = {
    info: { bg: colors.infoSoft, fg: colors.info },
    success: { bg: colors.successSoft, fg: colors.success },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    warning: { bg: colors.warningSoft, fg: colors.warning }
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]}>
      <Text style={[styles.bannerTitle, { color: palette.fg }]}>{title}</Text>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

function ReviewCard({ orderId, date, onSent }: { orderId: string; date: string; onSent: () => Promise<void> | void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => submitReview({ orderId, ...(rating > 0 ? { rating } : {}), comment }),
    onSuccess: async () => {
      setSent(true);
      await onSent();
    },
    onError: (caught) => setError(getErrorMessage(caught))
  });

  if (sent) {
    return <Banner text="Il aide la cuisine à faire encore mieux." title="Merci pour ton avis !" tone="success" />;
  }

  return (
    <Card style={styles.review}>
      <Text style={styles.sectionTitle}>Un mot sur ton repas ?</Text>
      <Text style={styles.reviewText}>Comment était celui de {formatDayMonth(date)} ? Ton avis est facultatif : c’est quand tu veux.</Text>
      <Stars onChange={setRating} value={rating} />
      <TextInput
        accessibilityLabel="Commentaire"
        maxLength={1000}
        onChangeText={setComment}
        placeholder="Dis-nous ce que tu as aimé…"
        placeholderTextColor={colors.muted}
        style={styles.comment}
        value={comment}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {rating > 0 || comment.trim() ? <AppButton label="Envoyer mon avis" loading={send.isPending} onPress={() => send.mutate()} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plan: { backgroundColor: colors.primarySoft, borderRadius: radii.round, paddingHorizontal: spacing.md, paddingVertical: 6 },
  planText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  heading: { gap: spacing.xs },
  date: { color: colors.muted, fontSize: 16, fontWeight: '700' },
  headline: { color: colors.primaryDark, fontSize: 36, fontWeight: '900', letterSpacing: -1, lineHeight: 40 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  timer: { color: colors.primary, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timerLate: { color: colors.danger },
  timerLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  sectionTag: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  today: { gap: spacing.xs },
  todayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  todayTitle: { color: colors.primaryDark, fontSize: 15, fontWeight: '900' },
  todayStatus: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  todayText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  upsell: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, opacity: 0.8 },
  upsellText: { color: colors.muted, fontSize: 13, fontStyle: 'italic' },
  offNote: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 60, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  optionDim: { opacity: 0.7 },
  optionText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  optionTextSelected: { color: colors.primaryDark, fontWeight: '800' },
  radio: { alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 12, borderColor: colors.border, borderWidth: 1.5 },
  radioSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  banner: { borderRadius: radii.lg, gap: 2, padding: spacing.md },
  bannerTitle: { fontSize: 15, fontWeight: '900' },
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  feedback: { color: colors.success, fontSize: 15, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  review: { gap: spacing.md, marginBottom: spacing.xl },
  reviewText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  comment: { minHeight: 50, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, color: colors.text, fontSize: 15, paddingHorizontal: spacing.md, backgroundColor: colors.surface }
});
