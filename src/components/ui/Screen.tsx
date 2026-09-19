import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/colors';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  style?: ViewProps['style'];
}

export function Screen({ children, scroll = true, contentContainerStyle, style }: ScreenProps) {
  if (!scroll) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safe, style]}>
        <BrandBackdrop />
        <View style={styles.content}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, style]}>
      <BrandBackdrop />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function BrandBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={styles.orangeGlow} />
      <View style={styles.greenGlow} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.md },
  scrollContent: { flexGrow: 1, padding: spacing.md, gap: spacing.md },
  orangeGlow: {
    position: 'absolute',
    right: -90,
    top: -110,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primarySoft,
    opacity: 0.55
  },
  greenGlow: {
    position: 'absolute',
    left: -80,
    bottom: -120,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.accentSoft,
    opacity: 0.55
  }
});
