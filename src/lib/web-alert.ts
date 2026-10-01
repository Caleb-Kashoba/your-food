/**
 * Sur le web, `Alert.alert` de React Native ne fait rien (ni message, ni boutons) : les confirmations et les erreurs
 * des écrans existants resteraient invisibles. Cet adaptateur les relaie vers les fenêtres du navigateur.
 * Sur mobile, rien ne change.
 */

import { Alert, Platform, type AlertButton } from 'react-native';

export function installWebAlert(): void {
  if (Platform.OS !== 'web' || typeof globalThis.alert !== 'function') return;

  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');

    // Simple information (aucun bouton, ou un seul)
    if (!buttons || buttons.length <= 1) {
      globalThis.alert(text);
      buttons?.[0]?.onPress?.();
      return;
    }

    // Confirmation : « OK » déclenche l'action principale, « Annuler » le bouton d'annulation
    const cancel = buttons.find((button) => button.style === 'cancel');
    const action = buttons.find((button) => button !== cancel) ?? buttons[buttons.length - 1];
    if (globalThis.confirm(text)) action?.onPress?.();
    else cancel?.onPress?.();
  };
}
