import type { Session } from '@supabase/supabase-js';
import { AppState, Linking, Platform } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  bootstrapFirstRoot,
  createSessionFromAuthLink,
  loadCurrentMember,
  signInWithPassword,
  signOut
} from '@/features/auth/auth.service';
import { parseAuthLink } from '@/features/auth/auth-link';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase/client';
import type { CurrentMember } from '@/types/domain';

interface AuthContextValue {
  session: Session | null;
  member: CurrentMember | null;
  loading: boolean;
  needsBootstrap: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  bootstrap: () => Promise<void>;
  refreshMember: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getCurrentWebUrl(): string | null {
  if (Platform.OS !== 'web' || typeof globalThis.location?.href !== 'string') return null;
  return globalThis.location.href;
}

function clearWebAuthParameters(url: string): void {
  if (Platform.OS !== 'web' || parseAuthLink(url).kind === 'none') return;
  if (typeof globalThis.history?.replaceState !== 'function' || !globalThis.location) return;

  globalThis.history.replaceState(globalThis.history.state, '', globalThis.location.pathname);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  const refreshMember = useCallback(async () => {
    if (!session) {
      setMember(null);
      return;
    }

    const nextMember = await loadCurrentMember(session);
    setMember(nextMember);
  }, [session]);

  useEffect(() => {
    if (!supabase) {
      return;
    }
    const client = supabase;
    let mounted = true;

    const applySession = async (nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession);
      setMember(nextSession ? await loadCurrentMember(nextSession) : null);
    };

    const processAuthUrl = async (url: string) => {
      setLoading(true);
      try {
        const linkedSession = await createSessionFromAuthLink(url);
        if (linkedSession) await applySession(linkedSession);
        setError(null);
      } catch (caught) {
        if (mounted) setError(getErrorMessage(caught));
      } finally {
        clearWebAuthParameters(url);
        if (mounted) setLoading(false);
      }
    };

    void (async () => {
      try {
        const initialUrl = getCurrentWebUrl() ?? await Linking.getInitialURL();
        let linkedSession: Session | null = null;
        if (initialUrl) {
          try {
            linkedSession = await createSessionFromAuthLink(initialUrl);
          } finally {
            clearWebAuthParameters(initialUrl);
          }
        }
        if (linkedSession) {
          await applySession(linkedSession);
          return;
        }

        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        await applySession(data.session);
      } catch (caught) {
        if (mounted) setError(getErrorMessage(caught));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError(null);
      if (!nextSession) {
        setMember(null);
      } else {
        void loadCurrentMember(nextSession)
          .then(setMember)
          .catch((caught: unknown) => setError(getErrorMessage(caught)));
      }
    });

    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
    const linkingListener = Linking.addEventListener('url', ({ url }) => {
      void processAuthUrl(url);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      appStateListener.remove();
      linkingListener.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      member,
      loading,
      needsBootstrap: Boolean(session && !member),
      error,
      signIn: async (email, password) => {
        setError(null);
        await signInWithPassword(email, password);
      },
      signOut: async () => {
        setError(null);
        await signOut();
      },
      bootstrap: async () => {
        setError(null);
        await bootstrapFirstRoot();
        await refreshMember();
      },
      refreshMember,
      hasPermission: (permission) => member?.role === 'root' || member?.permissions.includes(permission) === true
    }),
    [error, loading, member, refreshMember, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans AuthProvider.');
  return value;
}
