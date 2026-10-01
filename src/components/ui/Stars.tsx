import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/colors';

interface StarsProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  label?: string;
}

/** Note de 1 à 5 étoiles ; en lecture seule si `onChange` est absent */
export function Stars({ value, onChange, size = 26, label = 'Ta note' }: StarsProps) {
  return (
    <View accessibilityLabel={`${label} : ${value} sur 5`} style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => {
        const icon = <Ionicons color={star <= value ? colors.primary : colors.border} name={star <= value ? 'star' : 'star-outline'} size={size} />;
        return onChange ? (
          <Pressable accessibilityLabel={`${star} étoile${star > 1 ? 's' : ''}`} accessibilityRole="button" hitSlop={6} key={star} onPress={() => onChange(star === value ? 0 : star)}>
            {icon}
          </Pressable>
        ) : (
          <View key={star}>{icon}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.xs } });
