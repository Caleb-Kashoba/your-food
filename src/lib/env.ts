import { z } from 'zod';

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20)
});

const parsed = envSchema.safeParse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
});

export const env = parsed.success ? parsed.data : null;
/** Adresse publique du site (liens d'accès envoyés aux clients). Valeur publique, pas un secret. */
export const webBaseUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://your-food-gilt.vercel.app';

export const envError = parsed.success
  ? null
  : 'Configurez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY dans .env.';
