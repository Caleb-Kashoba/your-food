import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { env } from '@/lib/env';

export const supabase = env
  ? createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      },
      realtime: {
        params: {
          eventsPerSecond: 5
        }
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase n’est pas configuré. Consultez .env.example.');
  }

  return supabase;
}
