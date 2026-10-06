import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import {
  supportsPush,
  readPushState,
  setDevicePush,
} from '~/components/SidePanel/Notifications/push';
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

export function useDevicePush(label: string) {
  const { user } = useAuthContext();
  const { data: config } = useNotificationConfig();
  const client = useQueryClient();
  const key = [QueryKeys.notificationDevices, user?.tenantId, user?.id];
  const supported = supportsPush();
  const state = useQuery(key, readPushState, {
    enabled: !!user?.id && supported && !!config?.push,
    retry: false,
  });
  const change = useMutation((operation: Promise<void>) => operation, {
    networkMode: 'always',
    mutationKey: [MutationKeys.registerPushDevice, user?.id],
    onSettled: () => client.invalidateQueries(key),
  });
  // Start the permission request inside the click gesture, before React Query defers execution.
  const toggle = (enabled: boolean) =>
    change.mutate(setDevicePush(enabled, config?.push?.publicKey ?? '', label));
  return { config, supported, state, change, toggle };
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
