import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

export function useWorkspaceConfig() {
  const { user } = useAuthContext();
  return useQuery([QueryKeys.workspaceConfig, user?.id], dataService.getWorkspaceConfig, {
    enabled: !!user?.id,
    retry: false,
    staleTime: 60000,
  });
}
