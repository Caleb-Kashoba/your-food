import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme/colors';

export function ConnectivityBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Network.getNetworkStateAsync().then((state) => {
      if (mounted) setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    const subscription = Network.addNetworkStateListener((state) => {
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  if (!offline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Hors connexion — aucune modification ne sera présentée comme synchronisée.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.primaryDark, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  text: { color: colors.cream, fontSize: 12, fontWeight: '700', textAlign: 'center' }
});
