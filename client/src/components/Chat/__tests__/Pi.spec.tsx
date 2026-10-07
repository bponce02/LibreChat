import React from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Pi from '../Pi';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});
jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'owner' } }) }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { log: console.log, warn: console.warn, error: () => {} },
  });
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});
function show(isSubmitting = false) {
  return render(
    <QueryClientProvider client={client}>
      <Pi conversationId="chat" isSubmitting={isSubmitting} />
    </QueryClientProvider>,
  );
}
const status = {
  sessionId: 'session',
  leafId: 'leaf',
  lastMessageId: 'reply',
  disabled: false,
  pollIntervalMs: 15000,
};

test('linked history invalidates messages only when the synced tail is missing', async () => {
  jest.spyOn(dataService, 'getPiSyncStatus').mockResolvedValue(status);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  show();
  await screen.findByText('com_ui_pi_linked');
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith([QueryKeys.messages, 'chat']));
});

test('does not replace messages during streaming', async () => {
  jest.spyOn(dataService, 'getPiSyncStatus').mockResolvedValue(status);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  show(true);
  await screen.findByText('com_ui_pi_linked');
  expect(invalidate).not.toHaveBeenCalled();
});

test('loading, failure/retry and paused states', async () => {
  jest
    .spyOn(dataService, 'getPiSyncStatus')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ ...status, disabled: true });
  show();
  expect(screen.getByText('com_ui_pi_loading')).toBeVisible();
  await screen.findByText('com_ui_pi_error');
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
  await screen.findByText('com_ui_pi_paused');
});
