import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/colors';

interface SectionProps {
  title: string;
  /** Une ligne sous le titre, visible même replié (ex. « Tri : n° de bol · Filtre : Riz ») */
  summary?: string | null | undefined;
  /** Pastille à droite du titre (ex. « 5 bols ») */
  badge?: string | null | undefined;
  /** Ouverte au départ */
  initiallyOpen?: boolean;
  /** « danger » : zone des actions sensibles (suspendre, annuler, supprimer) */
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/**
 * Section repliable : un en-tête cliquable (titre, résumé, pastille) et son contenu.
 * Sert à ranger les réglages occasionnels et les actions sensibles sans les cacher complètement.
 */
export function Section({ title, summary, badge, initiallyOpen = false, tone = 'default', children }: SectionProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const danger = tone === 'danger';
  return (
    <View style={[styles.box, danger && styles.boxDanger]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.header}
      >
        <View style={styles.headerText}>
          <Text style={[styles.title, danger && styles.titleDanger]}>{title}</Text>
          {summary ? <Text numberOfLines={2} style={styles.summary}>{summary}</Text> : null}
        </View>
        {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
        <Ionicons color={danger ? colors.danger : colors.muted} name={open ? 'chevron-up' : 'chevron-down'} size={20} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg },
  boxDanger: { backgroundColor: colors.surface, borderColor: colors.dangerSoft, borderStyle: 'dashed' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  headerText: { flex: 1, gap: 2 },
  title: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  titleDanger: { color: colors.danger },
  summary: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  badge: { backgroundColor: colors.primarySoft, borderRadius: radii.round, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { color: colors.primaryPressed, fontSize: 13, fontWeight: '900' },
  body: { gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md }
});
