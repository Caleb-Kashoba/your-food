import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { create } from 'qrcode/lib/core/qrcode';

import { colors } from '@/theme/colors';

interface QrCodeProps {
  value: string;
  size?: number;
}

/** QR code dessiné avec des vues (aucune dépendance native) : les modules sombres consécutifs d'une ligne sont fusionnés */
export function QrCode({ value, size = 220 }: QrCodeProps) {
  const rows = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    const result: { start: number; length: number }[][] = [];
    for (let row = 0; row < modules.size; row += 1) {
      const runs: { start: number; length: number }[] = [];
      let start = -1;
      for (let column = 0; column <= modules.size; column += 1) {
        const dark = column < modules.size && modules.get(row, column) === 1;
        if (dark && start < 0) start = column;
        if (!dark && start >= 0) {
          runs.push({ start, length: column - start });
          start = -1;
        }
      }
      result.push(runs);
    }
    return { count: modules.size, rows: result };
  }, [value]);

  // 4 modules de marge blanche, comme l'exige la norme
  const margin = 4;
  const cell = size / (rows.count + margin * 2);

  return (
    <View accessibilityLabel="QR code d’accès" accessibilityRole="image" style={[styles.box, { width: size, height: size }]}>
      {rows.rows.flatMap((runs, rowIndex) =>
        runs.map((run) => (
          <View
            key={`${rowIndex}-${run.start}`}
            style={[
              styles.dark,
              { left: (run.start + margin) * cell, top: (rowIndex + margin) * cell, width: run.length * cell, height: cell + 0.5 }
            ]}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.white, position: 'relative', overflow: 'hidden' },
  dark: { position: 'absolute', backgroundColor: '#000000' }
});
