import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { CustomerForm } from '@/features/customers/CustomerForm';
import type { CustomerPayload } from '@/features/customers/customer.schema';
import { createCustomer } from '@/features/customers/customers.service';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';

export default function NewCustomerScreen() {
  const { member } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const save = async (values: CustomerPayload) => {
    if (!member) return;
    try {
      const id = await createCustomer(member.organizationId, member.id, values);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      router.replace({ pathname: '/customers/[id]', params: { id } });
    } catch (error) {
      Alert.alert('Création impossible', getErrorMessage(error));
    }
  };

  return (
    <Screen>
      <CustomerForm onSubmit={save} submitLabel="Créer le client" />
    </Screen>
  );
}
