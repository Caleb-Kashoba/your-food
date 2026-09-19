import type { Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { bootstrapFirstRoot, loadCurrentMember, signInWithPassword, signOut } from '@/features/auth/auth.service';
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

    void client.auth.getSession().then(async ({ data, error: sessionError }) => {
      try {
        if (sessionError) throw sessionError;
        setSession(data.session);
        if (data.session) setMember(await loadCurrentMember(data.session));
      } catch (caught) {
        setError(getErrorMessage(caught));
      } finally {
        setLoading(false);
      }
    });

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

    return () => {
      listener.subscription.unsubscribe();
      appStateListener.remove();
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
