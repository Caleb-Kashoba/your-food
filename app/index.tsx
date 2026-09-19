import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/AuthProvider';

export default function IndexScreen() {
  const { session, member } = useAuth();

  if (!session) return <Redirect href="/sign-in" />;
  if (!member) return <Redirect href="/bootstrap" />;
  return <Redirect href="/(tabs)" />;
}
