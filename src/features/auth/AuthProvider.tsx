import type { Session } from '@supabase/supabase-js';
import { AppState, Linking, Platform } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  bootstrapFirstRoot,
  createSessionFromAuthLink,
  loadCurrentCustomer,
  loadCurrentMember,
  signInWithPassword,
  signOut
} from '@/features/auth/auth.service';
import { parseAuthLink } from '@/features/auth/auth-link';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase/client';
import type { CurrentCustomer, CurrentMember } from '@/types/domain';

interface AuthContextValue {
  session: Session | null;
  member: CurrentMember | null;
  /** Renseigné quand le compte connecté est un client (et non un membre de l'équipe) */
  customer: CurrentCustomer | null;
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

/** Membre de l'équipe en priorité, sinon client */
async function loadIdentity(session: Session): Promise<{ member: CurrentMember | null; customer: CurrentCustomer | null }> {
  const member = await loadCurrentMember(session);
  if (member) return { member, customer: null };
  return { member: null, customer: await loadCurrentCustomer() };
}

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
  const [customer, setCustomer] = useState<CurrentCustomer | null>(null);
  const [resolving, setResolving] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  const refreshMember = useCallback(async () => {
    if (!session) {
      setMember(null);
      setCustomer(null);
      return;
    }

    const identity = await loadIdentity(session);
    setMember(identity.member);
    setCustomer(identity.customer);
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
      const identity = nextSession ? await loadIdentity(nextSession) : { member: null, customer: null };
      setMember(identity.member);
      setCustomer(identity.customer);
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
        setCustomer(null);
      } else {
        // Tant que l'identité n'est pas connue, la navigation attend (évite un renvoi vers l'initialisation)
        setResolving(true);
        void loadIdentity(nextSession)
          .then((identity) => {
            setMember(identity.member);
            setCustomer(identity.customer);
          })
          .catch((caught: unknown) => setError(getErrorMessage(caught)))
          .finally(() => setResolving(false));
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
      customer,
      loading: loading || resolving,
      needsBootstrap: Boolean(session && !member && !customer),
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
    [customer, error, loading, member, refreshMember, resolving, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans AuthProvider.');
  return value;
}
