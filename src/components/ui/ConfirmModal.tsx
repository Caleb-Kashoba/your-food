import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { colors, radii, shadows, spacing } from '@/theme/colors';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string | undefined;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean | undefined;
  danger?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation en fenêtre (Alert.alert ne propose pas de boutons sur le web) */
export function ConfirmModal({ visible, title, message, confirmLabel, cancelLabel, loading, danger, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <Pressable onPress={onCancel} style={styles.backdrop}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            <AppButton label={confirmLabel} loading={loading ?? false} onPress={onConfirm} variant={danger ? 'danger' : 'primary'} />
            <AppButton label={cancelLabel} onPress={onCancel} variant="secondary" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(53, 23, 14, 0.45)', padding: spacing.lg },
  sheet: { alignSelf: 'center', width: '100%', maxWidth: 440, gap: spacing.md, backgroundColor: colors.surfaceStrong, borderRadius: radii.xl, padding: spacing.lg, ...shadows.raised },
  title: { color: colors.primaryDark, fontSize: 22, fontWeight: '900' },
  message: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  actions: { gap: spacing.sm, marginTop: spacing.sm }
});
