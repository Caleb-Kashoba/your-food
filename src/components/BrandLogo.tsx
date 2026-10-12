import { Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, spacing } from '@/theme/colors';

interface BrandLogoProps {
  compact?: boolean;
  showTagline?: boolean;
  style?: ViewStyle;
}

// Logo complet (symbole + « YOUR FOOD »), fond transparent
const brandLogo = require('../../assets/images/brand-logo.png');
const LOGO_RATIO = 859 / 304;

export function BrandLogo({ compact = false, showTagline = false, style }: BrandLogoProps) {
  const height = compact ? 50 : 110;

  return (
    <View style={[styles.container, compact ? styles.compact : styles.hero, style]}>
      <Image accessibilityLabel="Your Food" resizeMode="contain" source={brandLogo} style={{ height, width: Math.round(height * LOGO_RATIO) }} />
      {showTagline ? <Text style={styles.tagline}>Bien manger, c’est aussi réussir.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  hero: { alignItems: 'center' },
  compact: { alignItems: 'flex-start' },
  tagline: { color: colors.accent, fontSize: 13, fontWeight: '700' }
});
