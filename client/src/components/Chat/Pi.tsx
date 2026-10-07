import { useEffect } from 'react';
import { Button } from '@librechat/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

export default function Pi({
  conversationId,
  isSubmitting,
}: {
  conversationId: string;
  isSubmitting: boolean;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const client = useQueryClient();
  const status = useQuery(
    [QueryKeys.piSync, user?.tenantId, user?.id, conversationId],
    () => dataService.getPiSyncStatus(conversationId),
    {
      enabled: !!user?.id,
      retry: false,
      refetchInterval: (data) => data?.pollIntervalMs ?? false,
    },
  );
  useEffect(() => {
    if (!status.data || isSubmitting) return;
    const key = [QueryKeys.messages, conversationId];
    if (
      client
        .getQueryData<TMessage[]>(key)
        ?.some((message) => message.messageId === status.data?.lastMessageId)
    )
      return;
    void client.invalidateQueries(key);
    void client.invalidateQueries([QueryKeys.allConversations]);
    void client.invalidateQueries([QueryKeys.projectConversations]);
  }, [client, conversationId, isSubmitting, status.data, status.dataUpdatedAt]);
  if (!status.isLoading && !status.isError && !status.data) return null;
  let content: React.ReactNode = localize(
    status.data?.disabled ? 'com_ui_pi_paused' : 'com_ui_pi_linked',
  );
  if (status.isLoading) content = localize('com_ui_pi_loading');
  else if (status.isError)
    content = (
      <>
        {localize('com_ui_pi_error')}{' '}
        <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </>
    );
  return (
    <div className="text-text-secondary px-4 py-2 text-center text-xs" role="status">
      {content}
    </div>
  );
}
