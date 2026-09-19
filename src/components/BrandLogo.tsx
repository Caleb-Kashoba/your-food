import { Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, spacing } from '@/theme/colors';

interface BrandLogoProps {
  compact?: boolean;
  showTagline?: boolean;
  style?: ViewStyle;
}

const brandMark = require('../../assets/images/brand-mark.png');

export function BrandLogo({ compact = false, showTagline = false, style }: BrandLogoProps) {
  const markSize = compact ? 46 : 82;

  return (
    <View style={[styles.container, compact ? styles.compact : styles.hero, style]}>
      <Image resizeMode="contain" source={brandMark} style={{ height: markSize, width: markSize }} />
      <View style={styles.copy}>
        <Text accessibilityLabel="Your Food" style={[styles.wordmark, compact && styles.wordmarkCompact]}>
          <Text style={styles.your}>YOUR </Text>
          <Text style={styles.food}>FOOD</Text>
        </Text>
        {showTagline ? <Text style={styles.tagline}>Bien manger, c’est aussi réussir.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  hero: { gap: spacing.sm },
  compact: { flexDirection: 'row', gap: spacing.sm },
  copy: { alignItems: 'flex-start' },
  wordmark: { fontSize: 32, fontWeight: '900', letterSpacing: -1.4, lineHeight: 36 },
  wordmarkCompact: { fontSize: 19, letterSpacing: -0.7, lineHeight: 23 },
  your: { color: colors.primaryDark },
  food: { color: colors.primary },
  tagline: { color: colors.accent, fontSize: 13, fontWeight: '700', marginTop: 2 }
});
