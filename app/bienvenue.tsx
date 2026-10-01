import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { LoadingView } from '@/components/ui/StateViews';
import { parseAccessLink, setPendingAccess } from '@/features/client-access/access-link';

/**
 * Arrivée par le lien envoyé au client (WhatsApp ou QR code) : …/bienvenue#acces=CODE&nom=Prénom+Nom.
 * Le code est lu dans la partie après le « # » (jamais envoyée au serveur), gardé en mémoire, puis retiré
 * de la barre d'adresse avant d'ouvrir la première connexion.
 */
export default function WelcomeLinkScreen() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void (async () => {
      const url = Platform.OS === 'web' ? globalThis.location?.href : await Linking.getInitialURL();
      const data = url ? parseAccessLink(url) : null;
      if (data) setPendingAccess(data);
      if (Platform.OS === 'web' && globalThis.history?.replaceState && globalThis.location) {
        globalThis.history.replaceState(globalThis.history.state, '', globalThis.location.pathname);
      }
      if (active) router.replace('/premiere-connexion');
    })();
    return () => {
      active = false;
    };
  }, [router]);

  return <LoadingView label="Ouverture de ton accès…" />;
}
