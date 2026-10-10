/**
 * Message lisible pour une erreur : une exception, un texte, ou l'objet d'erreur de Supabase (qui n'est pas une `Error`
 * mais porte un `message`). On évite le message générique tant qu'on connaît la vraie cause.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const { message, details, hint } = error as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof message === 'string' && message.trim()) {
      return [message, typeof details === 'string' ? details : '', typeof hint === 'string' ? hint : ''].filter((part) => part.trim()).join(' — ');
    }
  }

  return 'Une erreur inattendue est survenue.';
}
