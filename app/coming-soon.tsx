import { useLocalSearchParams } from 'expo-router';

import { EmptyView } from '@/components/ui/StateViews';
import { Screen } from '@/components/ui/Screen';

export default function ComingSoonScreen() {
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  return (
    <Screen contentContainerStyle={{ justifyContent: 'center' }}>
      <EmptyView
        message="Cette section est prévue après la stabilisation du suivi des abonnements, des livraisons et des paiements."
        title={feature ?? 'Fonctionnalité à venir'}
      />
    </Screen>
  );
}
