import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

export function useNotificationConfig() {
  const { user } = useAuthContext();
  return useQuery(
    [QueryKeys.notificationConfig, user?.tenantId, user?.id],
    dataService.getNotificationConfig,
    { enabled: !!user?.id, retry: false },
  );
}

export function useNotifications() {
  const { user } = useAuthContext();
  const { data: config } = useNotificationConfig();
  return useQuery(
    [QueryKeys.notifications, user?.tenantId, user?.id],
    dataService.listNotifications,
    {
      enabled: !!user?.id && config?.enabled === true,
      refetchInterval: config?.pollIntervalMs ?? false,
      retry: false,
    },
  );
}

export function useReadNotification() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const key = [QueryKeys.notifications, user?.tenantId, user?.id];
  return useMutation(dataService.readNotification, {
    mutationKey: [MutationKeys.readNotification, user?.tenantId, user?.id],
    onSuccess: () => queryClient.invalidateQueries(key),
  });
}
