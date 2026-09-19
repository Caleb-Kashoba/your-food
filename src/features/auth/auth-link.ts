export type AuthLinkResult =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string; code: string | null }
  | { kind: 'none' };

function collectParameters(url: string): URLSearchParams {
  const parsed = new URL(url);
  const parameters = new URLSearchParams(parsed.search);
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;

  for (const [key, value] of new URLSearchParams(fragment)) {
    if (!parameters.has(key)) parameters.set(key, value);
  }

  return parameters;
}

export function parseAuthLink(url: string): AuthLinkResult {
  try {
    const parameters = collectParameters(url);
    const error = parameters.get('error_description') ?? parameters.get('error');
    if (error) {
      return {
        kind: 'error',
        message: error.replaceAll('+', ' '),
        code: parameters.get('error_code')
      };
    }

    const accessToken = parameters.get('access_token');
    const refreshToken = parameters.get('refresh_token');
    if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };

    const code = parameters.get('code');
    if (code) return { kind: 'code', code };

    return { kind: 'none' };
  } catch {
    return { kind: 'error', message: 'Le lien d’activation est invalide.', code: 'invalid_url' };
  }
}
