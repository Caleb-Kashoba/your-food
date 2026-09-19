import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { ErrorView, LoadingView } from '@/components/ui/StateViews';
import { useAuth } from '@/features/auth/AuthProvider';
import { CustomerForm } from '@/features/customers/CustomerForm';
import type { CustomerPayload } from '@/features/customers/customer.schema';
import { getCustomer, updateCustomer } from '@/features/customers/customers.service';
import { getErrorMessage } from '@/lib/errors';

export default function EditCustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { member } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id), enabled: Boolean(id) });

  if (customer.isLoading) return <LoadingView />;
  if (customer.error || !customer.data) return <ErrorView message={getErrorMessage(customer.error)} onRetry={() => void customer.refetch()} />;

  const save = async (values: CustomerPayload) => {
    if (!member) return;
    try {
      await updateCustomer(id, member.id, values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer', id] })
      ]);
      router.back();
    } catch (error) {
      Alert.alert('Modification impossible', getErrorMessage(error));
    }
  };

  const item = customer.data;
  return (
    <Screen>
      <CustomerForm
        initialValues={{
          firstName: item.firstName,
          lastName: item.lastName,
          phone: item.phone,
          whatsapp: item.whatsapp ?? '',
          residence: item.residence ?? '',
          building: item.building ?? '',
          room: item.room ?? '',
          zoneId: item.zoneId,
          addressDetails: item.addressDetails ?? '',
          foodPreferences: item.foodPreferences ?? '',
          allergies: item.allergies ?? '',
          foodsToAvoid: item.foodsToAvoid ?? '',
          notes: item.notes ?? '',
          status: item.status
        }}
        onSubmit={save}
        submitLabel="Enregistrer"
      />
    </Screen>
  );
}
